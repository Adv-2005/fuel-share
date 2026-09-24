"use client";

import {
  ArrowDownLeft,
  ArrowUpRight,
  Bike,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Droplets,
  Fuel,
  History,
  IndianRupee,
  Pencil,
  Plus,
  Settings,
  Trash2,
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
  createRidePreset,
  createGroup,
  dashboardRidePresets,
  deleteRidePreset,
  joinGroup,
  loadCurrentGroup,
  logRideFromPreset,
  moveRidePreset,
  saveOpeningBalance,
  subscribeToGroup,
  updateEvent,
  updateGroupSettings,
  updateRidePreset,
  voidRide,
} from "@/lib/repository";
import { isCloudConfigured } from "@/lib/supabase";
import type { EventKind, GroupData, LedgerEvent, OpeningBalance, OpeningOwnershipMode, PaymentMethod, Ride, RidePreset, SuggestedTransfer } from "@/lib/types";

type ModalState =
  | { type: "ride"; preset?: RidePreset }
  | { type: "fuel" }
  | { type: "payment"; transfer?: SuggestedTransfer }
  | { type: "edit"; event: Exclude<LedgerEvent, OpeningBalance> }
  | { type: "opening"; opening?: OpeningBalance }
  | { type: "settings" }
  | { type: "presets" }
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
  const [step, setStep] = useState<"details" | "tank">("details");
  const [details, setDetails] = useState<{ groupName: string; vehicleName: string; displayName: string; capacity: number; mileage: number } | null>(null);
  const [tankChoice, setTankChoice] = useState<"empty" | "existing" | "deferred" | null>(null);
  const [openingLitres, setOpeningLitres] = useState("");
  const [openingPrice, setOpeningPrice] = useState("");
  const [openingOwnership, setOpeningOwnership] = useState<"single" | "shared">("single");

  function handleDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setDetails({
      groupName: String(form.get("groupName")), vehicleName: String(form.get("vehicleName")),
      displayName: String(form.get("displayName")), capacity: Number(form.get("capacity")), mileage: Number(form.get("mileage")),
    });
    setStep("tank");
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!details || !tankChoice) {
      setError("Choose the current tank state.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      onReady(await createGroup({
        groupName: details.groupName, vehicleName: details.vehicleName, displayName: details.displayName,
        tankCapacityLitres: details.capacity, mileageKmPerLitre: details.mileage,
        opening: tankChoice === "existing"
          ? { state: "existing", volumeLitres: Number(openingLitres), pricePerLitre: Number(openingPrice), ownershipMode: openingOwnership }
          : { state: tankChoice },
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
        <p>Start from the petrol that is actually in the tank. From then on, everyone only logs rides, refills, and repayments.</p>
        {!isCloudConfigured() && (
          <div className="mode-note"><strong>Local mode:</strong> You can try everything on this device. Connect Supabase before inviting other phones.</div>
        )}
      </section>
      {step === "details" ? (
        <form className="form-card setup-grid" onSubmit={handleDetails}>
          <p className="step-label">Step 1 of 2</p><h2>Scooter details</h2>
          <label>Group name<input name="groupName" required defaultValue={details?.groupName ?? "Our scooter"} /></label>
          <label>Creator&apos;s display name<input name="displayName" required defaultValue={details?.displayName} placeholder="e.g. Aditya" /></label>
          <label>Scooter name<input name="vehicleName" required defaultValue={details?.vehicleName ?? "Scooter"} /></label>
          <div className="two-columns">
            <label>Tank capacity in litres<input name="capacity" required type="number" min="0.5" max="50" step="0.1" defaultValue={details?.capacity ?? 5.3} /></label>
            <label>Estimated mileage in km/L<input name="mileage" required type="number" min="1" max="200" step="0.1" defaultValue={details?.mileage ?? 45} /></label>
          </div>
          <button className="primary-button">Continue to tank state</button>
        </form>
      ) : (
        <form className="form-card setup-grid" onSubmit={handleCreate}>
          <p className="step-label">Step 2 of 2</p><h2>Current tank state</h2>
          <div className="choice-list" role="radiogroup" aria-label="Current tank state">
            <button type="button" role="radio" aria-checked={tankChoice === "empty"} className={`choice-card ${tankChoice === "empty" ? "selected" : ""}`} onClick={() => setTankChoice("empty")}><strong>The tank is empty</strong><span>Start at zero. Your first refill can be any amount.</span></button>
            <button type="button" role="radio" aria-checked={tankChoice === "existing"} className={`choice-card ${tankChoice === "existing" ? "selected" : ""}`} onClick={() => setTankChoice("existing")}><strong>There is petrol in the tank</strong><span>Record an estimated opening volume and value.</span></button>
            <button type="button" role="radio" aria-checked={tankChoice === "deferred"} className={`choice-card ${tankChoice === "deferred" ? "selected" : ""}`} onClick={() => setTankChoice("deferred")}><strong>Set this up after members join</strong><span>Create the group and invite people first. Logging stays disabled.</span></button>
          </div>
          {tankChoice === "existing" && (
            <div className="opening-fields">
              <div className="quick-estimates" aria-label="Quick tank estimates">
                {[{ label: "Low", fraction: .1 }, { label: "¼", fraction: .25 }, { label: "½", fraction: .5 }, { label: "¾", fraction: .75 }, { label: "Full", fraction: 1 }].map((estimate) => (
                  <button key={estimate.label} type="button" onClick={() => setOpeningLitres(String(Math.round((details?.capacity ?? 0) * estimate.fraction * 100) / 100))}>{estimate.label}</button>
                ))}
              </div>
              <div className="two-columns">
                <label>Estimated litres currently present<input required type="number" min="0.001" max={details?.capacity} step="0.001" value={openingLitres} onChange={(event) => setOpeningLitres(event.target.value)} /></label>
                <label>Estimated petrol price per litre (₹)<input required type="number" min="0.01" step="0.01" value={openingPrice} onChange={(event) => setOpeningPrice(event.target.value)} /></label>
              </div>
              <div className="estimate-value"><span>Estimated opening value</span><strong>{formatMoney(Math.round(Number(openingLitres || 0) * Number(openingPrice || 0) * 100))}</strong></div>
              <fieldset className="ownership-options"><legend>Who owns this estimated petrol?</legend>
                <label><input type="radio" name="ownership" checked={openingOwnership === "single"} onChange={() => setOpeningOwnership("single")} /><span><strong>Paid by one member</strong><small>{details?.displayName} owns 100%.</small></span></label>
                <label className="disabled-option"><input type="radio" name="ownership" disabled /><span><strong>Split equally</strong><small>Choose “Set this up after members join” to select two or more owners.</small></span></label>
                <label><input type="radio" name="ownership" checked={openingOwnership === "shared"} onChange={() => setOpeningOwnership("shared")} /><span><strong>Shared old petrol — no repayment</strong><small>Included in ride costs, but nobody is credited.</small></span></label>
              </fieldset>
              <p className="field-help">Litres, price, and value are estimates and can be corrected later.</p>
            </div>
          )}
          {tankChoice === "deferred" && <div className="mode-note">After creation, copy the invite link. The admin can finish tank setup once the relevant members have joined.</div>}
          {error && <ErrorMessage message={error} />}
          <div className="form-actions"><button type="button" className="secondary-button" onClick={() => setStep("details")}>Back</button><button className="primary-button" disabled={busy || !tankChoice}>{busy ? "Creating…" : "Create FuelShare"}</button></div>
        </form>
      )}
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

function EntryModal({ state, data, onSaved, onClose }: { state: Exclude<ModalState, null | { type: "settings" } | { type: "opening" } | { type: "presets" }>; data: GroupData; onSaved: () => Promise<void>; onClose: () => void }) {
  const editing = state.type === "edit" ? state.event : null;
  let kind: EventKind;
  if (state.type === "edit") kind = state.event.kind;
  else if (state.type === "fuel") kind = "fuel_purchase";
  else kind = state.type;
  const transfer = state.type === "payment" ? state.transfer : undefined;
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saveAsPreset, setSaveAsPreset] = useState(false);
  const rideBeingEdited = editing?.kind === "ride" ? editing : null;
  const driverMemberId = rideBeingEdited?.riderMemberId ?? data.currentMemberId;
  const [participantMemberIds, setParticipantMemberIds] = useState<string[]>(
    rideBeingEdited?.participantMemberIds ?? [driverMemberId],
  );

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
          isFullTank: form.get("isFullTank") === "on",
          participantMemberIds: editing.kind === "ride" ? participantMemberIds : undefined,
          recipientMemberId: String(form.get("recipient")),
          method: (form.get("method") as PaymentMethod | null) ?? undefined,
          reference: String(form.get("reference") ?? ""),
          occurredAt,
          note: String(form.get("note") ?? ""),
        });
      } else if (kind === "ride") {
        let createdPreset: RidePreset | null = null;
        if (saveAsPreset) {
          createdPreset = await createRidePreset(data, {
            label: String(form.get("presetLabel") ?? ""),
            distanceKm: Number(form.get("distance")),
            isPinned: true,
          });
        }
        try {
          await addRide(data, {
            distanceKm: Number(form.get("distance")),
            participantMemberIds,
            occurredAt,
            note: String(form.get("note") ?? ""),
            presetId: state.type === "ride" ? state.preset?.id : undefined,
            presetLabel: state.type === "ride" ? state.preset?.label : undefined,
          });
        } catch (caught) {
          if (createdPreset) {
            try { await deleteRidePreset(data, createdPreset); } catch { /* Preserve the ride error shown to the member. */ }
          }
          throw caught;
        }
      } else if (kind === "fuel_purchase") {
        await addFuel(data, { amountRupees: Number(form.get("amount")), pricePerLitre: Number(form.get("price")), isFullTank: form.get("isFullTank") === "on", occurredAt, note: String(form.get("note") ?? "") });
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
  const otherMembers = data.members.filter((member) => member.id !== driverMemberId);
  const participantLimitReached = participantMemberIds.length >= 3;

  function toggleParticipant(memberId: string): void {
    setParticipantMemberIds((selected) => selected.includes(memberId)
      ? selected.filter((id) => id !== memberId)
      : selected.length < 3 ? [...selected, memberId] : selected);
  }
  return (
    <Modal title={title} onClose={onClose}>
      <form className="entry-form" onSubmit={submit}>
        {kind === "ride" && (
          <>
            <div className="identity-line"><Bike /><span>{memberName(data, driverMemberId)} is the driver</span></div>
            <label>Distance travelled (km)<input name="distance" required autoFocus type="number" min="0.1" max="1000" step="0.1" defaultValue={rideBeingEdited ? rideBeingEdited.distanceM / 1000 : state.type === "ride" && state.preset ? state.preset.distanceM / 1000 : ""} placeholder="12.5" /></label>
            <fieldset className="ride-participants">
              <legend>Who rode?</legend>
              <label className="locked-participant"><input type="checkbox" checked disabled /><span><strong>You / Driver</strong><small>{memberName(data, driverMemberId)}</small></span></label>
              {otherMembers.map((member) => {
                const selected = participantMemberIds.includes(member.id);
                return <label key={member.id}><input type="checkbox" checked={selected} disabled={!selected && participantLimitReached} onChange={() => toggleParticipant(member.id)} /><span>{member.displayName}</span></label>;
              })}
              <p>Fuel cost will be split equally among {participantMemberIds.length} rider{participantMemberIds.length === 1 ? "" : "s"}.</p>
              {participantLimitReached && otherMembers.some((member) => !participantMemberIds.includes(member.id)) && <small>A ride currently supports a maximum of three people.</small>}
            </fieldset>
            {!editing && (
              <>
                <label className="check-field"><input name="saveAsPreset" type="checkbox" checked={saveAsPreset} onChange={(event) => setSaveAsPreset(event.currentTarget.checked)} /><span><strong>Save as quick ride</strong><small>Add this distance to your personal one-tap shortcuts.</small></span></label>
                {saveAsPreset && <label>Preset label<input name="presetLabel" required minLength={1} maxLength={32} placeholder="e.g. College" /></label>}
              </>
            )}
          </>
        )}
        {kind === "fuel_purchase" && (
          <>
            <div className="identity-line"><Fuel /><span>{memberName(data, data.currentMemberId)} is paying</span></div>
            <div className="two-columns">
              <label>Amount paid (₹)<input name="amount" required autoFocus type="number" min="1" step="0.01" defaultValue={editing?.kind === "fuel_purchase" ? editing.amountPaise / 100 : ""} placeholder="500" /></label>
              <label>Price (₹/L)<input name="price" required type="number" min="1" step="0.01" defaultValue={editing?.kind === "fuel_purchase" ? editing.unitPricePaisePerLitre / 100 : ""} placeholder="102.50" /></label>
            </div>
            <label className="check-field"><input name="isFullTank" type="checkbox" defaultChecked={editing?.kind === "fuel_purchase" && editing.isFullTank} /><span><strong>Filled the tank completely</strong><small>Uses the pump litres to correct the estimated fuel balance.</small></span></label>
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

function PresetManager({ data, onSaved, onClose }: { data: GroupData; onSaved: () => Promise<void>; onClose: () => void }) {
  const [editing, setEditing] = useState<RidePreset | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const ordered = [...data.presets].sort((a, b) => a.displayOrder - b.displayOrder || a.createdAt.localeCompare(b.createdAt));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const input = {
      label: String(form.get("label") ?? ""),
      distanceKm: Number(form.get("distance")),
      isPinned: form.get("isPinned") === "on",
    };
    try {
      if (editing) await updateRidePreset(data, editing, input);
      else await createRidePreset(data, input);
      setEditing(null);
      await onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save this quick ride.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(preset: RidePreset) {
    if (!window.confirm(`Delete ${preset.label}? Earlier rides will stay in your history.`)) return;
    setError("");
    try {
      await deleteRidePreset(data, preset);
      if (editing?.id === preset.id) setEditing(null);
      await onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete this quick ride.");
    }
  }

  async function move(preset: RidePreset, direction: "up" | "down") {
    setError("");
    try {
      await moveRidePreset(data, preset, direction);
      await onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not reorder quick rides.");
    }
  }

  return (
    <Modal title="Manage quick rides" onClose={onClose}>
      {ordered.length > 0 && (
        <div className="preset-list">
          {ordered.map((preset, index) => (
            <article className="preset-row" key={preset.id}>
              <div><strong>{preset.label}</strong><small>{formatDistance(preset.distanceM)}{preset.isPinned ? " · Pinned" : ""}</small></div>
              <div className="preset-row-actions">
                <button className="icon-button small" onClick={() => void move(preset, "up")} disabled={index === 0} aria-label={`Move ${preset.label} up`}><ChevronUp /></button>
                <button className="icon-button small" onClick={() => void move(preset, "down")} disabled={index === ordered.length - 1} aria-label={`Move ${preset.label} down`}><ChevronDown /></button>
                <button className="icon-button small" onClick={() => setEditing(preset)} aria-label={`Edit ${preset.label}`}><Pencil /></button>
                <button className="icon-button small danger-button" onClick={() => void remove(preset)} aria-label={`Delete ${preset.label}`}><Trash2 /></button>
              </div>
            </article>
          ))}
        </div>
      )}
      {!editing && ordered.length >= 6 ? <p className="field-help">You have reached the limit of 6 quick rides.</p> : (
        <form className="entry-form preset-form" key={editing?.id ?? "new"} onSubmit={submit}>
          <h3>{editing ? `Edit ${editing.label}` : "Add a preset"}</h3>
          <label>Label<input name="label" required minLength={1} maxLength={32} defaultValue={editing?.label ?? ""} placeholder="e.g. College" /></label>
          <label>Distance (km)<input name="distance" required type="number" min="0.1" max="200" step="0.1" defaultValue={editing ? editing.distanceM / 1000 : ""} placeholder="8" /></label>
          <label className="check-field"><input name="isPinned" type="checkbox" defaultChecked={editing?.isPinned ?? true} /><span><strong>Pin to dashboard</strong><small>The dashboard shows your first four pinned quick rides.</small></span></label>
          {error && <ErrorMessage message={error} />}
          <div className="form-actions">
            {editing && <button className="secondary-button" type="button" onClick={() => setEditing(null)}>Cancel</button>}
            <button className="primary-button" disabled={busy}>{busy ? "Saving…" : editing ? "Save changes" : "Add preset"}</button>
          </div>
        </form>
      )}
      {error && !editing && ordered.length >= 6 && <ErrorMessage message={error} />}
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

function OpeningBalanceModal({ data, opening, onSaved, onClose }: { data: GroupData; opening?: OpeningBalance; onSaved: () => Promise<void>; onClose: () => void }) {
  const initialMode = opening?.ownershipMode ?? "empty";
  const [mode, setMode] = useState<OpeningOwnershipMode>(initialMode);
  const [litres, setLitres] = useState(opening && opening.volumeMl > 0 ? String(opening.volumeMl / 1000) : "");
  const [price, setPrice] = useState(opening && opening.unitPricePaisePerLitre > 0 ? String(opening.unitPricePaisePerLitre / 100) : "");
  const [selectedIds, setSelectedIds] = useState<string[]>(opening?.ownerShares.map((share) => share.memberId) ?? []);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function chooseMode(nextMode: OpeningOwnershipMode) {
    setMode(nextMode);
    if (nextMode === "empty" || nextMode === "shared") setSelectedIds([]);
    if (nextMode === "single" && selectedIds.length !== 1) setSelectedIds([data.currentMemberId]);
  }

  function toggleEqualOwner(memberId: string) {
    setSelectedIds((current) => current.includes(memberId) ? current.filter((id) => id !== memberId) : [...current, memberId]);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await saveOpeningBalance(data, {
        volumeLitres: mode === "empty" ? 0 : Number(litres),
        pricePerLitre: mode === "empty" ? 0 : Number(price),
        ownershipMode: mode,
        ownerMemberIds: mode === "single" || mode === "equal" ? selectedIds : [],
      });
      await onSaved();
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the opening balance.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={opening ? "Correct opening tank balance" : "Finish tank setup"} onClose={onClose}>
      <form className="entry-form" onSubmit={submit}>
        <div className="choice-list compact" role="radiogroup" aria-label="Opening tank state">
          <button type="button" role="radio" aria-checked={mode === "empty"} className={`choice-card ${mode === "empty" ? "selected" : ""}`} onClick={() => chooseMode("empty")}><strong>The tank is empty</strong></button>
          <button type="button" role="radio" aria-checked={mode !== "empty"} className={`choice-card ${mode !== "empty" ? "selected" : ""}`} onClick={() => chooseMode(mode === "empty" ? "single" : mode)}><strong>There is petrol in the tank</strong></button>
        </div>
        {mode !== "empty" && (
          <>
            <div className="quick-estimates" aria-label="Quick tank estimates">
              {[{ label: "Low", fraction: .1 }, { label: "¼", fraction: .25 }, { label: "½", fraction: .5 }, { label: "¾", fraction: .75 }, { label: "Full", fraction: 1 }].map((estimate) => (
                <button key={estimate.label} type="button" onClick={() => setLitres(String(Math.round(data.group.tankCapacityMl / 1000 * estimate.fraction * 100) / 100))}>{estimate.label}</button>
              ))}
            </div>
            <div className="two-columns">
              <label>Estimated litres currently present<input required type="number" min="0.001" max={data.group.tankCapacityMl / 1000} step="0.001" value={litres} onChange={(event) => setLitres(event.target.value)} /></label>
              <label>Estimated petrol price per litre (₹)<input required type="number" min="0.01" step="0.01" value={price} onChange={(event) => setPrice(event.target.value)} /></label>
            </div>
            <div className="estimate-value"><span>Estimated opening value</span><strong>{formatMoney(Math.round(Number(litres || 0) * Number(price || 0) * 100))}</strong></div>
            <fieldset className="ownership-options"><legend>Who owns this estimated petrol?</legend>
              <label><input type="radio" name="openingOwnerMode" checked={mode === "single"} onChange={() => chooseMode("single")} /><span><strong>Paid by one member</strong><small>That member owns 100%.</small></span></label>
              {mode === "single" && <select aria-label="Opening petrol owner" value={selectedIds[0] ?? ""} onChange={(event) => setSelectedIds([event.target.value])}>{data.members.map((member) => <option key={member.id} value={member.id}>{member.displayName}</option>)}</select>}
              <label><input type="radio" name="openingOwnerMode" checked={mode === "equal"} onChange={() => chooseMode("equal")} /><span><strong>Split equally</strong><small>Select at least two joined members.</small></span></label>
              {mode === "equal" && <div className="member-checks">{data.members.map((member) => <label key={member.id}><input type="checkbox" checked={selectedIds.includes(member.id)} onChange={() => toggleEqualOwner(member.id)} />{member.displayName}</label>)}</div>}
              <label><input type="radio" name="openingOwnerMode" checked={mode === "shared"} onChange={() => chooseMode("shared")} /><span><strong>Shared old petrol — no repayment</strong><small>Track its use without crediting anyone.</small></span></label>
            </fieldset>
            <p className="field-help">These litres, price, and value are estimates.</p>
          </>
        )}
        {opening && <p className="field-help">The previous values and ownership remain in correction history.</p>}
        {error && <ErrorMessage message={error} />}
        <button className="primary-button" disabled={busy}>{busy ? "Saving…" : opening ? "Save correction" : "Finish tank setup"}</button>
      </form>
    </Modal>
  );
}

function Dashboard({ data, onRefresh }: { data: GroupData; onRefresh: () => Promise<void> }) {
  const [modal, setModal] = useState<ModalState>(null);
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState<"home" | "activity" | "people">("home");
  const [openRevisionId, setOpenRevisionId] = useState<string | null>(null);
  const [optimisticRides, setOptimisticRides] = useState<Ride[]>([]);
  const [quickBusyId, setQuickBusyId] = useState<string | null>(null);
  const [quickError, setQuickError] = useState("");
  const [toast, setToast] = useState<{ ride: Ride; label: string; pendingSync: boolean } | null>(null);
  const effectiveRides = useMemo(() => [
    ...data.rides,
    ...optimisticRides.filter((ride) => !data.rides.some((stored) => stored.id === ride.id)),
  ], [data.rides, optimisticRides]);
  const pendingEventIds = useMemo(() => [...new Set([
    ...data.pendingEventIds,
    ...optimisticRides.filter((ride) => typeof navigator !== "undefined" && !navigator.onLine && !ride.deletedAt).map((ride) => ride.id),
  ])], [data.pendingEventIds, optimisticRides]);
  const snapshot = useMemo(() => calculateLedger(data.group, data.members, data.purchases, effectiveRides, data.payments, data.openingBalances), [data, effectiveRides]);
  const currentMember = data.members.find((member) => member.id === data.currentMemberId);
  const activities = useMemo(() => ([...data.openingBalances, ...data.purchases, ...effectiveRides, ...data.payments] as LedgerEvent[])
    .filter((event) => !event.deletedAt)
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)), [data.openingBalances, data.purchases, data.payments, effectiveRides]);
  const quickRides = useMemo(() => dashboardRidePresets(data.presets), [data.presets]);
  const inviteUrl = typeof window === "undefined" ? "" : `${window.location.origin}/join/${data.group.inviteCode}`;
  const latestCalibration = snapshot.calibrations.at(-1);
  const calibrationByEventId = new Map(snapshot.calibrations.map((calibration) => [calibration.eventId, calibration]));

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 12_000);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  function signedLitres(millilitres: number): string {
    return `${millilitres >= 0 ? "+" : "−"}${formatLitres(Math.abs(millilitres))}`;
  }

  async function copyInvite() {
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  async function logQuickRide(preset: RidePreset) {
    setQuickBusyId(preset.id);
    setQuickError("");
    try {
      const result = await logRideFromPreset(data, preset);
      setOptimisticRides((rides) => [...rides.filter((ride) => ride.id !== result.ride.id), result.ride]);
      setToast({ ride: result.ride, label: preset.label, pendingSync: result.pendingSync });
      if (!result.pendingSync) await onRefresh();
    } catch (caught) {
      setQuickError(caught instanceof Error ? caught.message : "Could not add this ride.");
    } finally {
      setQuickBusyId(null);
    }
  }

  async function undoQuickRide() {
    if (!toast) return;
    setQuickError("");
    try {
      await voidRide(data, toast.ride);
      const deletedAt = new Date().toISOString();
      setOptimisticRides((rides) => rides.map((ride) => ride.id === toast.ride.id ? { ...ride, deletedAt } : ride));
      setToast(null);
      if (!toast.pendingSync) await onRefresh();
    } catch (caught) {
      setQuickError(caught instanceof Error ? caught.message : "Could not undo this ride.");
    }
  }

  function eventSummary(event: LedgerEvent): { icon: React.ReactNode; title: string; detail: string; amount?: string } {
    if (event.kind === "opening_balance") {
      const ownership = event.ownershipMode === "empty" ? "empty tank"
        : event.ownershipMode === "shared" ? "Shared opening fuel"
          : event.ownershipMode === "equal" ? `split equally between ${event.ownerShares.length} members`
            : `owned by ${memberName(data, event.ownerShares[0]?.memberId ?? "")}`;
      return {
        icon: <Droplets />, title: "Opening tank balance",
        detail: event.volumeMl === 0 ? ownership : `${formatLitres(event.volumeMl)} estimated · ${ownership}`,
        amount: formatMoney(event.amountPaise),
      };
    }
    if (event.kind === "fuel_purchase") {
      const calibration = calibrationByEventId.get(event.id);
      const calibrationDetail = calibration
        ? ` · full-tank calibration: ${formatLitres(calibration.estimatedBeforeMl)} estimated → ${formatLitres(calibration.actualBeforeMl)} actual (${signedLitres(calibration.adjustmentMl)})`
        : "";
      return {
        icon: <Fuel />, title: `${memberName(data, event.payerMemberId)} refilled`,
        detail: `${formatLitres(event.volumeMl)} at ${formatMoney(event.unitPricePaisePerLitre)}/L${calibrationDetail}`, amount: formatMoney(event.amountPaise),
      };
    }
    if (event.kind === "ride") {
      const passengerNames = event.participantMemberIds
        .filter((memberId) => memberId !== event.riderMemberId)
        .map((memberId) => memberName(data, memberId));
      const passengerText = passengerNames.length === 0 ? ""
        : passengerNames.length <= 2 ? ` with ${passengerNames.join(" and ")}`
          : ` with ${passengerNames[0]} and ${passengerNames.length - 1} others`;
      return {
        icon: <Bike />,
        title: `${memberName(data, event.riderMemberId)} rode${passengerText}${event.presetLabel ? ` · ${event.presetLabel}` : ""}`,
        detail: `${formatLitres(event.consumedMl)} estimated use`,
        amount: formatDistance(event.distanceM),
      };
    }
    return {
      icon: <IndianRupee />, title: `${memberName(data, event.payerMemberId)} paid ${memberName(data, event.recipientMemberId)}`,
      detail: event.reference || event.method.toUpperCase(), amount: formatMoney(event.amountPaise),
    };
  }

  function previousVersionSummary(previous: Record<string, unknown>, kind: EventKind): string {
    const numberValue = (camel: string, snake: string): number => Number(previous[camel] ?? previous[snake] ?? 0);
    if (kind === "opening_balance") {
      const ownership = String(previous.ownershipMode ?? previous.ownership_mode ?? "unknown").replace("shared", "Shared opening fuel");
      return `${formatLitres(numberValue("volumeMl", "volume_ml"))} opening fuel worth ${formatMoney(numberValue("amountPaise", "amount_paise"))} · ${ownership}`;
    }
    if (kind === "ride") {
      const ids = (previous.participantMemberIds ?? previous.participant_member_ids) as string[] | undefined;
      const participants = ids?.map((memberId) => memberName(data, memberId)).join(", ");
      return `${formatDistance(numberValue("distanceM", "distance_m"))} ride${participants ? ` · ${participants}` : ""}`;
    }
    if (kind === "fuel_purchase") {
      const wasFullTank = previous.isFullTank === true || previous.is_full_tank === true;
      return `${formatMoney(numberValue("amountPaise", "amount_paise"))} refill at ${formatMoney(numberValue("unitPricePaisePerLitre", "unit_price_paise_per_litre"))}/L${wasFullTank ? " · full-tank calibration" : ""}`;
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
      {pendingEventIds.length > 0 && <div className="pending-banner"><span>{pendingEventIds.length} offline entr{pendingEventIds.length === 1 ? "y is" : "ies are"} waiting to sync.</span></div>}

      {data.group.setupStatus === "pending" && (
        <section className="setup-pending-card">
          <div className="brand-mark"><Droplets /></div>
          <p className="eyebrow">Opening balance needed</p>
          <h2>Finish tank setup</h2>
          <p>Rides and refills stay disabled until the current petrol and its owners are recorded.</p>
          <div className="joined-members"><strong>{data.members.length} joined member{data.members.length === 1 ? "" : "s"}</strong><span>{data.members.map((member) => member.displayName).join(", ")}</span></div>
          {currentMember?.role === "admin" ? <button className="primary-button" onClick={() => setModal({ type: "opening" })}>Finish tank setup</button> : <div className="mode-note">Waiting for the group admin to finish tank setup.</div>}
          <button className="secondary-button" onClick={copyInvite}>{copied ? <Check /> : <Copy />}{copied ? "Copied" : "Copy invite link"}</button>
        </section>
      )}

      {tab === "home" && data.group.setupStatus === "complete" && (
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

          {latestCalibration && (
            <div className="calibration-note">
              <Check />
              <span>Before the last full refill, FuelShare estimated {formatLitres(latestCalibration.estimatedBeforeMl)} and the pump showed {formatLitres(latestCalibration.actualBeforeMl)}. Corrected by <strong>{signedLitres(latestCalibration.adjustmentMl)}</strong>.</span>
            </div>
          )}

          <section className="quick-actions" aria-label="Quick actions">
            <button className="action ride-action" onClick={() => setModal({ type: "ride" })}><span><Bike /></span><b>Log ride</b><small>Just enter kilometres</small></button>
            <button className="action fuel-action" onClick={() => setModal({ type: "fuel" })}><span><Fuel /></span><b>Add petrol</b><small>Amount and price/L</small></button>
          </section>

          <section className="quick-rides-section" aria-labelledby="quick-rides-title">
            <div className="quick-rides-heading"><h2 id="quick-rides-title">Quick rides</h2><button className="text-button" onClick={() => setModal({ type: "presets" })}>Manage quick rides</button></div>
            {data.presets.length === 0 ? (
              <div className="quick-rides-empty"><p>Add common routes to log rides in one tap.</p><button className="secondary-button" onClick={() => setModal({ type: "presets" })}><Plus /> Add preset</button></div>
            ) : (
              <div className="quick-ride-buttons">
                {quickRides.map((preset) => <div className="quick-ride-option" key={preset.id}><button disabled={quickBusyId !== null} onClick={() => void logQuickRide(preset)}>{quickBusyId === preset.id ? "Adding…" : <><strong>{preset.label}</strong><span>· {formatDistance(preset.distanceM)}</span></>}</button><button className="with-people-button" onClick={() => setModal({ type: "ride", preset })}>Log with people</button></div>)}
                <button className="add-preset-button" onClick={() => setModal({ type: "presets" })}><Plus /> Add</button>
              </div>
            )}
            {quickError && <ErrorMessage message={quickError} />}
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
              {snapshot.tank.sharedOpeningMl > 0 && <div className="owner-row"><span className="mini-avatar">S</span><div><strong>Shared opening fuel</strong><small>{formatLitres(snapshot.tank.sharedOpeningMl)} still in tank · no repayment</small></div><b>{formatMoney(snapshot.tank.sharedOpeningValuePaise)}</b></div>}
              {snapshot.tank.unattributedMl > 0 && <div className="owner-row"><span className="mini-avatar">≈</span><div><strong>Calibration adjustment</strong><small>{formatLitres(snapshot.tank.unattributedMl)} was already accounted for</small></div><b>—</b></div>}
              {snapshot.fuelOwners.length === 0 && snapshot.tank.sharedOpeningMl === 0 && snapshot.tank.unattributedMl === 0 && <p className="muted">No petrol is recorded in the tank.</p>}
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
                    <div className="activity-main"><strong>{summary.title}</strong><small>{summary.detail} · {new Date(event.occurredAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</small>{pendingEventIds.includes(event.id) && <em className="pending-label">Pending sync</em>}{revisionCount > 0 && <button className="revision-link" onClick={() => setOpenRevisionId(openRevisionId === event.id ? null : event.id)}>{revisionCount} correction{revisionCount > 1 ? "s" : ""} recorded</button>}</div>
                    <b>{summary.amount}</b>
                    {event.kind === "opening_balance" && currentMember?.role === "admin"
                      ? <button className="icon-button small" onClick={() => setModal({ type: "opening", opening: event })} aria-label="Correct Opening tank balance"><Pencil /></button>
                      : event.kind !== "opening_balance" && event.createdByUserId === data.currentUserId && <button className="icon-button small" onClick={() => setModal({ type: "edit", event })} aria-label={`Correct ${summary.title}`}><Pencil /></button>}
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
                <div><strong>{memberName(data, balance.memberId)}{balance.memberId === data.currentMemberId ? " (you)" : ""}</strong><small>{formatDistance(balance.distanceM)} participated · {formatMoney(balance.rideCostPaise)} used</small></div>
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

      {toast && <div className="ride-toast" role="status"><span><strong>{toast.label} ride added</strong>{toast.pendingSync && <small>Pending sync</small>}</span><button onClick={() => void undoQuickRide()}>Undo</button></div>}

      {modal && modal.type !== "settings" && modal.type !== "opening" && modal.type !== "presets" && <EntryModal state={modal} data={data} onSaved={onRefresh} onClose={() => setModal(null)} />}
      {modal?.type === "settings" && <SettingsModal data={data} onSaved={onRefresh} onClose={() => setModal(null)} />}
      {modal?.type === "presets" && <PresetManager data={data} onSaved={onRefresh} onClose={() => setModal(null)} />}
      {modal?.type === "opening" && <OpeningBalanceModal data={data} opening={modal.opening} onSaved={onRefresh} onClose={() => setModal(null)} />}
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
