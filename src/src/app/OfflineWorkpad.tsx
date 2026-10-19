"use client";

import { useEffect, useState } from "react";

type OfflineWorkItem = {
  id: string;
  category: string;
  reference: string;
  details: string;
  amount: string;
  createdAt: string;
  status?: "À reprendre" | "En cours" | "Terminé";
};

const STORAGE_KEY = "aero_offline_workpad_v1";
const categories = [
  "Inscription / dossier",
  "Paiement à vérifier",
  "Validation à effectuer",
  "Présence / retard / absence",
  "Pénalité à examiner",
  "Formation / planning",
  "Suivi / alerte",
  "Autre opération",
];


function parseSemicolonCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  const source = input.replace(/^\uFEFF/, "");
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === '"' && quoted && source[i + 1] === '"') { cell += '"'; i++; }
    else if (ch === '"') quoted = !quoted;
    else if (ch === ";" && !quoted) { row.push(cell); cell = ""; }
    else if ((ch === "\n" || ch === "\r") && !quoted) {
      if (ch === "\r" && source[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((v) => v.length)) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((v) => v.length)) rows.push(row);
  return rows;
}

export default function OfflineWorkpad() {
  const [online, setOnline] = useState(true);
  const [items, setItems] = useState<OfflineWorkItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState(categories[0]);
  const [reference, setReference] = useState("");
  const [details, setDetails] = useState("");
  const [amount, setAmount] = useState("");
  const [message, setMessage] = useState("");
  const [filter, setFilter] = useState<"Toutes" | "À reprendre" | "En cours" | "Terminé">("Toutes");

  useEffect(() => {
    const refresh = () => setOnline(navigator.onLine);
    refresh();
    window.addEventListener("online", refresh);
    window.addEventListener("offline", refresh);
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setItems(parsed);
      }
    } catch { /* Keep the workpad usable if local storage is unavailable. */ }
    finally { setLoaded(true); }
    return () => {
      window.removeEventListener("online", refresh);
      window.removeEventListener("offline", refresh);
    };
  }, []);

  useEffect(() => {
    // Do not overwrite existing notes with the initial empty state before the first read finishes.
    if (!loaded) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items)); } catch {
      setMessage("Le navigateur n’a pas pu conserver les notes. Exportez-les ou utilisez aussi un registre papier.");
    }
  }, [items, loaded]);

  function saveItem(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (details.trim().length < 3) {
      setMessage("Décrivez l’opération à reprendre.");
      return;
    }
    const id = typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : String(Date.now()) + "-" + Math.random().toString(16).slice(2);
    const item: OfflineWorkItem = {
      id,
      category,
      reference: reference.trim(),
      details: details.trim(),
      amount: amount.trim(),
      createdAt: new Date().toISOString(),
      status: "À reprendre",
    };
    setItems((current) => [item, ...current]);
    setReference("");
    setDetails("");
    setAmount("");
    setMessage("Note conservée sur cet appareil. Aucune inscription, aucun paiement ni aucune validation n’a été envoyé au serveur.");
  }

  function exportItems() {
    if (items.length === 0) {
      setMessage("Aucune note à exporter.");
      return;
    }
    const csvCell = (value: unknown) => '"' + String(value ?? "").replace(/"/g, '""') + '"';
    const headers = ["Type d’opération", "Référence", "Détails à reprendre", "Montant indicatif", "Statut de reprise", "Créé le", "ID local"];
    const rows = items.map((item) => [item.category, item.reference, item.details, item.amount, item.status || "À reprendre", item.createdAt, item.id]);
    const csv = "\uFEFF" + [headers, ...rows].map((row) => row.map(csvCell).join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "aero-service-carnet-hors-connexion.csv";
    link.click();
    URL.revokeObjectURL(url);
    setMessage("Export réalisé. Le fichier peut contenir des données personnelles : gardez-le en lieu sûr.");
  }

  async function importItems(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { setMessage("Fichier trop volumineux (maximum 2 Mo)."); return; }
    try {
      const rows = parseSemicolonCsv(await file.text());
      if (rows.length < 2) throw new Error("empty");
      const headers = rows[0].map((v) => v.trim());
      const required = ["Type d’opération", "Référence", "Détails à reprendre", "Montant indicatif", "Statut de reprise", "Créé le", "ID local"];
      const col = (name: string) => headers.indexOf(name);
      if (required.some((name) => col(name) < 0)) throw new Error("format");
      const imported: OfflineWorkItem[] = [];
      for (const row of rows.slice(1)) {
        const detailsValue = row[col("Détails à reprendre")] || "";
        const categoryValue = row[col("Type d’opération")] || "";
        if (detailsValue.trim().length < 3) continue;
        const rawStatus = row[col("Statut de reprise")];
        const rawDate = Date.parse(row[col("Créé le")] || "");
        imported.push({
          id: (row[col("ID local")] || "").trim() || (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now()) + "-" + imported.length),
          category: categories.includes(categoryValue) ? categoryValue : "Autre opération",
          reference: (row[col("Référence")] || "").slice(0, 120),
          details: detailsValue.slice(0, 1500),
          amount: (row[col("Montant indicatif")] || "").slice(0, 40),
          createdAt: Number.isFinite(rawDate) ? new Date(rawDate).toISOString() : new Date().toISOString(),
          status: rawStatus === "En cours" || rawStatus === "Terminé" ? rawStatus : "À reprendre",
        });
        if (imported.length >= 1000) break;
      }
      if (!imported.length) { setMessage("Aucune note valide trouvée dans ce fichier."); return; }
      const existing = new Set(items.map((item) => item.id));
      const unique = imported.filter((item) => !existing.has(item.id));
      if (!window.confirm("Importer " + unique.length + " note(s) nouvelles ? Les identifiants déjà présents seront ignorés. Aucune opération officielle ne sera validée.")) return;
      setItems((current) => {
        const ids = new Set(current.map((item) => item.id));
        return [...unique.filter((item) => !ids.has(item.id)), ...current];
      });
      setMessage(unique.length ? unique.length + " note(s) importée(s) localement. Aucune opération officielle n’a été transmise." : "Toutes les notes de ce fichier sont déjà présentes.");
    } catch {
      setMessage("Import impossible : utilisez un export CSV du Carnet de reprise Aéro Service.");
    }
  }

  return (
    <aside style={{ position: "fixed", zIndex: 1000, right: 14, bottom: 14, width: "min(390px, calc(100vw - 28px))", fontFamily: "inherit", color: "#17324d" }}>
      <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}
        style={{ display: "block", marginLeft: "auto", border: "1px solid #9fb6cc", borderRadius: 999, background: online ? "#123b63" : "#8a5700", color: "white", padding: "10px 15px", fontWeight: 700, boxShadow: "0 3px 14px #0002", cursor: "pointer" }}>
        {online ? "Carnet de reprise" : "Carnet hors connexion"}{items.length ? " (" + items.length + ")" : ""}
      </button>
      {open && <section style={{ marginTop: 8, maxHeight: "min(72vh, 650px)", overflowY: "auto", background: "#fff", border: "1px solid #b7c8d8", borderRadius: 14, padding: 14, boxShadow: "0 8px 30px #0003" }}>
        <h2 style={{ margin: "0 0 6px", fontSize: 17 }}>Carnet de reprise Aéro Service</h2>
        <p style={{ fontSize: 12, lineHeight: 1.45, marginTop: 0, color: "#5c440f" }}>
          {online ? "Pour noter les opérations à reprendre ou vérifier après une panne." : "Mode hors connexion : notez le travail à reprendre."}
          {" "}Ces notes restent dans ce navigateur ; elles ne sont pas envoyées automatiquement au serveur. N’y inscrivez pas de mot de passe, de coordonnées bancaires, ni de détails médicaux. Sur un ordinateur partagé, utilisez une référence non nominative et effacez les notes après régularisation.
        </p>
        <form onSubmit={saveItem} style={{ display: "grid", gap: 8 }}>
          <label style={{ display: "grid", gap: 4, fontSize: 13 }}>Type d’opération
            <select value={category} onChange={(event) => setCategory(event.target.value)} style={{ width: "100%", padding: 8, border: "1px solid #b7c8d8", borderRadius: 7, background: "white" }}>
              {categories.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label style={{ display: "grid", gap: 4, fontSize: 13 }}>Référence / matricule (facultatif)
            <input value={reference} onChange={(event) => setReference(event.target.value)} maxLength={120} style={{ width: "100%", padding: 8, border: "1px solid #b7c8d8", borderRadius: 7 }} />
          </label>
          <label style={{ display: "grid", gap: 4, fontSize: 13 }}>Détails à reprendre
            <textarea value={details} onChange={(event) => setDetails(event.target.value)} required minLength={3} maxLength={1500} rows={3} style={{ width: "100%", padding: 8, border: "1px solid #b7c8d8", borderRadius: 7, resize: "vertical" }} placeholder="Ex. dossier reçu, contrôler les pièces puis finaliser l’inscription." />
          </label>
          <label style={{ display: "grid", gap: 4, fontSize: 13 }}>Montant indicatif (facultatif)
            <input value={amount} onChange={(event) => setAmount(event.target.value)} maxLength={40} style={{ width: "100%", padding: 8, border: "1px solid #b7c8d8", borderRadius: 7 }} placeholder="Ex. 15 000 FCFA — non validé" />
          </label>
          <button type="submit" style={{ border: 0, borderRadius: 8, padding: 10, background: "#123b63", color: "white", fontWeight: 700, cursor: "pointer" }}>Conserver la note sur cet appareil</button>
        </form>
        {message && <p role="status" style={{ fontSize: 12, lineHeight: 1.4 }}>{message}</p>}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "10px 0" }}>
          <button type="button" onClick={exportItems} disabled={!items.length} style={{ padding: "7px 9px", border: "1px solid #9fb6cc", borderRadius: 7, background: "white", cursor: "pointer" }}>Exporter CSV</button>
          <label style={{ display: "inline-flex", alignItems: "center", padding: "7px 9px", border: "1px solid #9fb6cc", borderRadius: 7, background: "white", cursor: "pointer", fontSize: 13 }}>
            Importer un CSV
            <input type="file" accept=".csv,text/csv" onChange={importItems} style={{ display: "none" }} />
          </label>
          <button type="button" onClick={() => { if (items.length && window.confirm("Supprimer toutes les notes locales de ce navigateur ? Vérifiez d’abord vos exports.")) { setItems([]); setMessage("Carnet local vidé."); } }} disabled={!items.length} style={{ padding: "7px 9px", border: "1px solid #d6a3a3", borderRadius: 7, background: "white", color: "#8f2020", cursor: "pointer" }}>Effacer le carnet</button>
        </div>
        <p style={{ fontSize: 11, lineHeight: 1.4, color: "#6c4a16" }}>Confidentialité : les notes sont stockées localement sans chiffrement dans le navigateur. Sur un ordinateur partagé, évitez les informations sensibles, exportez ce qui est nécessaire et effacez le carnet après régularisation. En cas de panne, gardez aussi un registre papier.</p>
        {items.length > 0 && <>
          <label style={{ display: "grid", gap: 4, fontSize: 13, margin: "10px 0" }}>Filtrer le suivi
            <select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)} style={{ width: "100%", padding: 8, border: "1px solid #b7c8d8", borderRadius: 7, background: "white" }}>
              <option value="Toutes">Toutes les notes ({items.length})</option>
              <option value="À reprendre">À reprendre ({items.filter((item) => (item.status || "À reprendre") === "À reprendre").length})</option>
              <option value="En cours">En cours ({items.filter((item) => item.status === "En cours").length})</option>
              <option value="Terminé">Terminées ({items.filter((item) => item.status === "Terminé").length})</option>
            </select>
          </label>
          <ol style={{ paddingLeft: 20, fontSize: 12, lineHeight: 1.45 }}>
            {items.filter((item) => filter === "Toutes" || (item.status || "À reprendre") === filter).slice(0, 20).map((item) => <li key={item.id} style={{ marginBottom: 10 }}>
              <strong>{item.category}</strong>{item.reference ? " — " + item.reference : ""}
              <div>{item.details}</div>
              {item.amount && <div>Montant indicatif : {item.amount}</div>}
              <div style={{ color: "#63778a" }}>{new Date(item.createdAt).toLocaleString("fr-FR")}</div>
              <label style={{ display: "grid", gap: 4, marginTop: 5 }}>État de reprise
                <select value={item.status || "À reprendre"} onChange={(event) => setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, status: event.target.value as OfflineWorkItem["status"] } : entry))} style={{ width: "100%", padding: 7, border: "1px solid #b7c8d8", borderRadius: 7, background: "white" }}>
                  <option>À reprendre</option><option>En cours</option><option>Terminé</option>
                </select>
              </label>
              {item.status === "Terminé" && <p style={{ margin: "4px 0", color: "#17663b" }}>Note clôturée localement — cela ne confirme pas la validation dans Aéro Service.</p>}
              <button type="button" onClick={() => setItems((current) => current.filter((entry) => entry.id !== item.id))} style={{ marginTop: 3, border: 0, background: "transparent", color: "#8f2020", padding: 0, cursor: "pointer" }}>Supprimer cette note</button>
            </li>)}
          </ol>
          {items.filter((item) => filter === "Toutes" || (item.status || "À reprendre") === filter).length > 20 && <p>Seules les 20 premières notes de ce filtre sont affichées ; l’export CSV contient toutes les notes.</p>}
        </>}
      </section>}
    </aside>
  );
}
