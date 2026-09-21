"use client";

import {
  ArrowDownLeft,
  ArrowUpRight,
  Bike,
  Check,
  Copy,
  Droplets,
  Fuel,
  History,
  IndianRupee,
  Pencil,
  Plus,
  Settings,
  Users,
  X,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { formatDistance, formatLitres, formatMoney, fromLocalDateTimeInput, toLocalDateTimeInput } from "@/lib/format";
import { calculateLedger } from "@/lib/ledger";
import {
  addFuel,
  addPayment,
  addRide,
  createGroup,
  joinGroup,
  loadCurrentGroup,
  subscribeToGroup,
  updateEvent,
  updateGroupSettings,
} from "@/lib/repository";
import { isCloudConfigured } from "@/lib/supabase";
import type { EventKind, GroupData, LedgerEvent, PaymentMethod, SuggestedTransfer } from "@/lib/types";

type ModalState =
  | { type: "ride" }
  | { type: "fuel" }
  | { type: "payment"; transfer?: SuggestedTransfer }
  | { type: "edit"; event: LedgerEvent }
  | { type: "settings" }
  | null;

function memberName(data: GroupData, memberId: string): string {
  return data.members.find((member) => member.id === memberId)?.displayName ?? "Unknown member";
}

function ErrorMessage({ message }: { message: string }) {
  return <div className="alert" role="alert">{message}</div>;
}

function LoadingScreen() {
  return (
    <main className="center-screen">
      <div className="brand-mark"><Fuel aria-hidden="true" /></div>
      <p>Loading your scooter ledger…</p>
    </main>
  );
}

function Onboarding({ inviteCode, onReady }: { inviteCode?: string; onReady: (data: GroupData) => void }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      onReady(await createGroup({
        groupName: String(form.get("groupName")),
        vehicleName: String(form.get("vehicleName")),
        displayName: String(form.get("displayName")),
        tankCapacityLitres: Number(form.get("capacity")),
        mileageKmPerLitre: Number(form.get("mileage")),
        initialAmountRupees: Number(form.get("amount")),
        initialPricePerLitre: Number(form.get("price")),
      }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create the group.");
    } finally {
      setBusy(false);
    }
  }

  async function handleJoin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      onReady(await joinGroup(String(form.get("inviteCode")), String(form.get("displayName"))));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not join the group.");
    } finally {
      setBusy(false);
    }
  }

  if (inviteCode) {
    return (
      <main className="onboarding-shell">
        <section className="welcome-copy">
          <div className="brand-mark"><Fuel aria-hidden="true" /></div>
          <p className="eyebrow">FuelShare invite</p>
          <h1>Join the scooter group</h1>
          <p>Choose the name your flatmates know you by. This device will remember you.</p>
        </section>
        <form className="form-card" onSubmit={handleJoin}>
          <input type="hidden" name="inviteCode" value={inviteCode} />
          <label>Your display name<input name="displayName" required minLength={1} maxLength={40} autoFocus placeholder="e.g. Aditya" /></label>
          {error && <ErrorMessage message={error} />}
          <button className="primary-button" disabled={busy}>{busy ? "Joining…" : "Join group"}</button>
        </form>
      </main>
    );
  }

  return (
    <main className="onboarding-shell">
      <section className="welcome-copy">
        <div className="brand-mark"><Fuel aria-hidden="true" /></div>
        <p className="eyebrow">FuelShare</p>
        <h1>Petrol tracking your group will actually use.</h1>
        <p>Start after a known refill. From then on, everyone only logs rides, refills, and repayments.</p>
        {!isCloudConfigured() && (
          <div className="mode-note"><strong>Local mode:</strong> You can try everything on this device. Connect Supabase before inviting other phones.</div>
        )}
      </section>
      <form className="form-card setup-grid" onSubmit={handleCreate}>
        <h2>Create your group</h2>
        <label>Group name<input name="groupName" required defaultValue="Our scooter" /></label>
        <label>Your name<input name="displayName" required placeholder="e.g. Aditya" /></label>
        <label>Scooter name<input name="vehicleName" required defaultValue="Scooter" /></label>
        <div className="two-columns">
          <label>Tank capacity (L)<input name="capacity" required type="number" min="0.5" max="50" step="0.1" defaultValue="5.3" /></label>
          <label>Mileage (km/L)<input name="mileage" required type="number" min="1" max="200" step="0.1" defaultValue="45" /></label>
        </div>
        <div className="form-separator"><span>First known refill</span></div>
        <div className="two-columns">
          <label>Amount paid (₹)<input name="amount" required type="number" min="1" step="0.01" placeholder="500" /></label>
          <label>Petrol price (₹/L)<input name="price" required type="number" min="1" step="0.01" placeholder="102.50" /></label>
        </div>
        <p className="field-help">For a clean start, make this a refill from a near-empty or otherwise known tank.</p>
        {error && <ErrorMessage message={error} />}
        <button className="primary-button" disabled={busy}>{busy ? "Creating…" : "Create FuelShare"}</button>
      </form>
    </main>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div className="modal-header"><h2 id="modal-title">{title}</h2><button className="icon-button" onClick={onClose} aria-label="Close"><X /></button></div>
        {children}
      </section>
    </div>
  );
}

function EntryModal({ state, data, onSaved, onClose }: { state: Exclude<ModalState, null | { type: "settings" }>; data: GroupData; onSaved: () => Promise<void>; onClose: () => void }) {
  const editing = state.type === "edit" ? state.event : null;
  let kind: EventKind;
  if (state.type === "edit") kind = state.event.kind;
  else if (state.type === "fuel") kind = "fuel_purchase";
  else kind = state.type;
  const transfer = state.type === "payment" ? state.transfer : undefined;
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const title = editing ? "Correct entry" : kind === "ride" ? "Log a ride" : kind === "fuel_purchase" ? "Log a refill" : "Record a repayment";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const occurredAt = fromLocalDateTimeInput(String(form.get("occurredAt")));
    try {
      if (editing) {
        await updateEvent(data, editing, {
          distanceKm: Number(form.get("distance")),
          amountRupees: Number(form.get("amount")),
          pricePerLitre: Number(form.get("price")),
          recipientMemberId: String(form.get("recipient")),
          method: (form.get("method") as PaymentMethod | null) ?? undefined,
          reference: String(form.get("reference") ?? ""),
          occurredAt,
          note: String(form.get("note") ?? ""),
        });
      } else if (kind === "ride") {
        await addRide(data, { distanceKm: Number(form.get("distance")), occurredAt, note: String(form.get("note") ?? "") });
      } else if (kind === "fuel_purchase") {
        await addFuel(data, { amountRupees: Number(form.get("amount")), pricePerLitre: Number(form.get("price")), occurredAt, note: String(form.get("note") ?? "") });
      } else {
        await addPayment(data, {
          recipientMemberId: String(form.get("recipient")), amountRupees: Number(form.get("amount")),
          method: form.get("method") as PaymentMethod, reference: String(form.get("reference") ?? ""), occurredAt,
        });
      }
      await onSaved();
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save this entry.");
    } finally {
      setBusy(false);
    }
  }

  const occurredAt = editing?.occurredAt ?? new Date().toISOString();
  const defaultRecipient = editing?.kind === "payment" ? editing.recipientMemberId : transfer?.toMemberId;
  return (
    <Modal title={title} onClose={onClose}>
      <form className="entry-form" onSubmit={submit}>
        {kind === "ride" && (
          <>
            <div className="identity-line"><Bike /><span>{memberName(data, data.currentMemberId)} is riding</span></div>
            <label>Distance travelled (km)<input name="distance" required autoFocus type="number" min="0.1" max="1000" step="0.1" defaultValue={editing?.kind === "ride" ? editing.distanceM / 1000 : ""} placeholder="12.5" /></label>
          </>
        )}
        {kind === "fuel_purchase" && (
          <>
            <div className="identity-line"><Fuel /><span>{memberName(data, data.currentMemberId)} is paying</span></div>
            <div className="two-columns">
              <label>Amount paid (₹)<input name="amount" required autoFocus type="number" min="1" step="0.01" defaultValue={editing?.kind === "fuel_purchase" ? editing.amountPaise / 100 : ""} placeholder="500" /></label>
              <label>Price (₹/L)<input name="price" required type="number" min="1" step="0.01" defaultValue={editing?.kind === "fuel_purchase" ? editing.unitPricePaisePerLitre / 100 : ""} placeholder="102.50" /></label>
            </div>
          </>
        )}
        {kind === "payment" && (
          <>
            <label>Paid to<select name="recipient" required defaultValue={defaultRecipient ?? ""}>
              <option value="" disabled>Select member</option>
              {data.members.filter((member) => member.id !== data.currentMemberId).map((member) => <option key={member.id} value={member.id}>{member.displayName}</option>)}
            </select></label>
            <div className="two-columns">
              <label>Amount (₹)<input name="amount" required type="number" min="0.01" step="0.01" defaultValue={editing?.kind === "payment" ? editing.amountPaise / 100 : transfer ? transfer.amountPaise / 100 : ""} /></label>
              <label>Method<select name="method" defaultValue={editing?.kind === "payment" ? editing.method : "upi"}><option value="upi">UPI</option><option value="cash">Cash</option></select></label>
            </div>
            <label>Reference (optional)<input name="reference" maxLength={120} defaultValue={editing?.kind === "payment" ? editing.reference : ""} placeholder="UPI reference or note" /></label>
          </>
        )}
        <label>Date and time<input name="occurredAt" required type="datetime-local" defaultValue={toLocalDateTimeInput(occurredAt)} /></label>
        {kind !== "payment" && <label>Note (optional)<input name="note" maxLength={240} defaultValue={editing?.note ?? ""} placeholder="Short context" /></label>}
        {editing && <p className="field-help">The previous version remains visible in correction history.</p>}
        {error && <ErrorMessage message={error} />}
        <button className="primary-button" disabled={busy}>{busy ? "Saving…" : editing ? "Save correction" : "Save"}</button>
      </form>
    </Modal>
  );
}

function SettingsModal({ data, onSaved, onClose }: { data: GroupData; onSaved: () => Promise<void>; onClose: () => void }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      await updateGroupSettings(data, String(form.get("vehicleName")), Number(form.get("capacity")), Number(form.get("mileage")));
      await onSaved();
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update settings.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Scooter settings" onClose={onClose}>
      <form className="entry-form" onSubmit={submit}>
        <label>Scooter name<input name="vehicleName" required defaultValue={data.group.vehicleName} /></label>
        <div className="two-columns">
          <label>Tank capacity (L)<input name="capacity" required type="number" min="0.5" max="50" step="0.1" defaultValue={data.group.tankCapacityMl / 1000} /></label>
          <label>Future mileage (km/L)<input name="mileage" required type="number" min="1" max="200" step="0.1" defaultValue={data.group.mileageMPerLitre / 1000} /></label>
        </div>
        <p className="field-help">Mileage changes only affect rides logged after this update.</p>
        {error && <ErrorMessage message={error} />}
        <button className="primary-button" disabled={busy}>{busy ? "Saving…" : "Save settings"}</button>
      </form>
    </Modal>
  );
}

function Dashboard({ data, onRefresh }: { data: GroupData; onRefresh: () => Promise<void> }) {
  const [modal, setModal] = useState<ModalState>(null);
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState<"home" | "activity" | "people">("home");
  const [openRevisionId, setOpenRevisionId] = useState<string | null>(null);
  const snapshot = useMemo(() => calculateLedger(data.group, data.members, data.purchases, data.rides, data.payments), [data]);
  const currentMember = data.members.find((member) => member.id === data.currentMemberId);
  const activities = useMemo(() => ([...data.purchases, ...data.rides, ...data.payments] as LedgerEvent[])
    .filter((event) => !event.deletedAt)
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)), [data]);
  const inviteUrl = typeof window === "undefined" ? "" : `${window.location.origin}/join/${data.group.inviteCode}`;

  async function copyInvite() {
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  function eventSummary(event: LedgerEvent): { icon: React.ReactNode; title: string; detail: string; amount?: string } {
    if (event.kind === "fuel_purchase") return {
      icon: <Fuel />, title: `${memberName(data, event.payerMemberId)} refilled`,
      detail: `${formatLitres(event.volumeMl)} at ${formatMoney(event.unitPricePaisePerLitre)}/L`, amount: formatMoney(event.amountPaise),
    };
    if (event.kind === "ride") return {
      icon: <Bike />, title: `${memberName(data, event.riderMemberId)} rode`,
      detail: `${formatLitres(event.consumedMl)} estimated use`, amount: formatDistance(event.distanceM),
    };
    return {
      icon: <IndianRupee />, title: `${memberName(data, event.payerMemberId)} paid ${memberName(data, event.recipientMemberId)}`,
      detail: event.reference || event.method.toUpperCase(), amount: formatMoney(event.amountPaise),
    };
  }

  function previousVersionSummary(previous: Record<string, unknown>, kind: EventKind): string {
    const numberValue = (camel: string, snake: string): number => Number(previous[camel] ?? previous[snake] ?? 0);
    if (kind === "ride") return `${formatDistance(numberValue("distanceM", "distance_m"))} ride`;
    if (kind === "fuel_purchase") {
      return `${formatMoney(numberValue("amountPaise", "amount_paise"))} refill at ${formatMoney(numberValue("unitPricePaisePerLitre", "unit_price_paise_per_litre"))}/L`;
    }
    return `${formatMoney(numberValue("amountPaise", "amount_paise"))} repayment`;
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div><p className="eyebrow">{data.group.name}</p><h1>{data.group.vehicleName}</h1></div>
        <button className="avatar" onClick={() => setTab("people")} aria-label="Open people">{currentMember?.displayName.slice(0, 1).toUpperCase()}</button>
      </header>

      {data.mode === "local" && <div className="local-banner"><span>Local preview — connect Supabase to sync six phones.</span></div>}
      {data.pendingEventIds.length > 0 && <div className="pending-banner"><span>{data.pendingEventIds.length} offline entr{data.pendingEventIds.length === 1 ? "y is" : "ies are"} waiting to sync.</span></div>}

      {tab === "home" && (
        <>
          <section className="tank-card" aria-label="Estimated fuel remaining">
            <div className="tank-copy">
              <p>Estimated in tank</p>
              <h2>{formatLitres(snapshot.tank.remainingMl)}</h2>
              <strong>{formatMoney(snapshot.tank.remainingValuePaise)} of petrol</strong>
              <span>Based on {data.group.mileageMPerLitre / 1000} km/L</span>
            </div>
            <div className="tank-visual" aria-hidden="true">
              <div className="tank-fill" style={{ height: `${snapshot.tank.percent}%` }} />
              <Droplets />
              <b>{Math.round(snapshot.tank.percent)}%</b>
            </div>
          </section>

          {snapshot.issues.length > 0 && <ErrorMessage message={snapshot.issues[0].message} />}

          <section className="quick-actions" aria-label="Quick actions">
            <button className="action ride-action" onClick={() => setModal({ type: "ride" })}><span><Bike /></span><b>Log ride</b><small>Just enter kilometres</small></button>
            <button className="action fuel-action" onClick={() => setModal({ type: "fuel" })}><span><Fuel /></span><b>Add petrol</b><small>Amount and price/L</small></button>
          </section>

          <section className="section-block">
            <div className="section-heading"><div><p className="eyebrow">Settle up</p><h2>Who pays whom</h2></div><button className="text-button" onClick={() => setModal({ type: "payment" })}><Plus /> Record payment</button></div>
            {snapshot.suggestedTransfers.length === 0 ? (
              <div className="empty-state"><span className="success-icon"><Check /></span><div><strong>Everyone is settled</strong><p>No petrol repayments are pending.</p></div></div>
            ) : (
              <div className="settlement-list">
                {snapshot.suggestedTransfers.map((transfer) => (
                  <article className="settlement-row" key={`${transfer.fromMemberId}-${transfer.toMemberId}`}>
                    <div><strong>{memberName(data, transfer.fromMemberId)}</strong><span> pays </span><strong>{memberName(data, transfer.toMemberId)}</strong></div>
                    <b>{formatMoney(transfer.amountPaise)}</b>
                    {transfer.fromMemberId === data.currentMemberId && <button onClick={() => setModal({ type: "payment", transfer })}>Mark paid</button>}
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="section-block">
            <div className="section-heading"><div><p className="eyebrow">Tank ownership</p><h2>Who funded what’s left</h2></div></div>
            <div className="owner-list">
              {snapshot.fuelOwners.map((owner) => (
                <div className="owner-row" key={owner.memberId}><span className="mini-avatar">{memberName(data, owner.memberId).slice(0, 1)}</span><div><strong>{memberName(data, owner.memberId)}</strong><small>{formatLitres(owner.remainingMl)} still in tank</small></div><b>{formatMoney(owner.remainingValuePaise)}</b></div>
              ))}
              {snapshot.fuelOwners.length === 0 && <p className="muted">No petrol is recorded in the tank.</p>}
            </div>
          </section>
        </>
      )}

      {tab === "activity" && (
        <section className="section-block activity-page">
          <div className="section-heading"><div><p className="eyebrow">Audit trail</p><h2>Recent activity</h2></div></div>
          <div className="activity-list">
            {activities.map((event) => {
              const summary = eventSummary(event);
              const revisionCount = data.revisions.filter((revision) => revision.entityId === event.id).length;
              return (
                <div className="activity-entry" key={event.id}>
                  <article className="activity-row">
                    <span className="activity-icon">{summary.icon}</span>
                    <div className="activity-main"><strong>{summary.title}</strong><small>{summary.detail} · {new Date(event.occurredAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</small>{data.pendingEventIds.includes(event.id) && <em className="pending-label">Pending sync</em>}{revisionCount > 0 && <button className="revision-link" onClick={() => setOpenRevisionId(openRevisionId === event.id ? null : event.id)}>{revisionCount} correction{revisionCount > 1 ? "s" : ""} recorded</button>}</div>
                    <b>{summary.amount}</b>
                    {event.createdByUserId === data.currentUserId && <button className="icon-button small" onClick={() => setModal({ type: "edit", event })} aria-label={`Correct ${summary.title}`}><Pencil /></button>}
                  </article>
                  {openRevisionId === event.id && (
                    <div className="revision-panel">
                      <strong>Previous versions</strong>
                      {data.revisions.filter((revision) => revision.entityId === event.id).map((revision) => (
                        <div key={revision.id}><span>{previousVersionSummary(revision.previousData, revision.entityType)}</span><time>{new Date(revision.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</time></div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {tab === "people" && (
        <section className="section-block people-page">
          <div className="section-heading"><div><p className="eyebrow">Your group</p><h2>{data.members.length} members</h2></div>{currentMember?.role === "admin" && <button className="icon-button" onClick={() => setModal({ type: "settings" })} aria-label="Scooter settings"><Settings /></button>}</div>
          <div className="people-list">
            {snapshot.memberBalances.map((balance) => (
              <article className="person-row" key={balance.memberId}>
                <span className="avatar static">{memberName(data, balance.memberId).slice(0, 1)}</span>
                <div><strong>{memberName(data, balance.memberId)}{balance.memberId === data.currentMemberId ? " (you)" : ""}</strong><small>{formatDistance(balance.distanceM)} ridden · {formatMoney(balance.rideCostPaise)} used</small></div>
                <div className={balance.balancePaise > 0 ? "balance positive" : balance.balancePaise < 0 ? "balance negative" : "balance"}>
                  {balance.balancePaise > 0 ? <ArrowDownLeft /> : balance.balancePaise < 0 ? <ArrowUpRight /> : <Check />}
                  <span>{balance.balancePaise > 0 ? "gets " : balance.balancePaise < 0 ? "owes " : "settled"}{balance.balancePaise !== 0 && formatMoney(Math.abs(balance.balancePaise))}</span>
                </div>
              </article>
            ))}
          </div>
          <div className="invite-card">
            <div><strong>Invite a flatmate</strong><p>The link connects their device to this group.</p></div>
            <button className="secondary-button" onClick={copyInvite}>{copied ? <Check /> : <Copy />}{copied ? "Copied" : "Copy invite"}</button>
          </div>
        </section>
      )}

      <nav className="bottom-nav" aria-label="Main navigation">
        <button className={tab === "home" ? "active" : ""} onClick={() => setTab("home")}><Droplets /><span>Home</span></button>
        <button className={tab === "activity" ? "active" : ""} onClick={() => setTab("activity")}><History /><span>Activity</span></button>
        <button className={tab === "people" ? "active" : ""} onClick={() => setTab("people")}><Users /><span>People</span></button>
      </nav>

      {modal && modal.type !== "settings" && <EntryModal state={modal} data={data} onSaved={onRefresh} onClose={() => setModal(null)} />}
      {modal?.type === "settings" && <SettingsModal data={data} onSaved={onRefresh} onClose={() => setModal(null)} />}
    </main>
  );
}

export function FuelShareApp({ inviteCode }: { inviteCode?: string }) {
  const [data, setData] = useState<GroupData | null>(null);
  const [loading, setLoading] = useState(!inviteCode);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    if (!data) return;
    const fresh = await loadCurrentGroup(data.group.id);
    if (fresh) setData(fresh);
  }, [data]);

  useEffect(() => {
    if (inviteCode) return;
    void loadCurrentGroup().then(setData).catch((caught: unknown) => {
      setError(caught instanceof Error ? caught.message : "Could not load FuelShare.");
    }).finally(() => setLoading(false));
  }, [inviteCode]);

  useEffect(() => {
    if (!data) return;
    return subscribeToGroup(data.group.id, () => { void loadCurrentGroup(data.group.id).then((fresh) => fresh && setData(fresh)); });
  }, [data?.group.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <LoadingScreen />;
  if (error) return <main className="center-screen"><ErrorMessage message={error} /><button className="secondary-button" onClick={() => window.location.reload()}>Try again</button></main>;
  if (!data) return <Onboarding inviteCode={inviteCode} onReady={(ready) => { setData(ready); window.history.replaceState(null, "", "/"); }} />;
  return <Dashboard data={data} onRefresh={refresh} />;
}
