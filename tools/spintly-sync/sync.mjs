// Spintly (OptiSpaces) → Chamaria HRMS attendance sync.
//
// Pulls each day's swipes from the same endpoint the OptiSpaces dashboard uses
// (undocumented — may change) and writes them to Firestore attendance/{employeeId}_{date},
// the same shape the HRMS "Attendance Import" page writes.
//
// Env:
//   SPINTLY_EMAIL, SPINTLY_PASSWORD   dashboard login (email + password, no OTP)
//   FIREBASE_SERVICE_ACCOUNT          service-account JSON for chamariagroup-hrms
//   SYNC_DATE   optional YYYY-MM-DD (default: today and yesterday, IST)
//   DRY_RUN=1   fetch + match only, write nothing
import { CognitoUserPool, CognitoUser, AuthenticationDetails } from "amazon-cognito-identity-js";

const POOL = { UserPoolId: "ap-south-1_FJvXB4KPj", ClientId: "24lqc87njds5aqjknibohr5ero" };
const API = "https://saams.api.spintly.com";
const ORG = 5542;
const DRY = process.env.DRY_RUN === "1";

function need(k){ const v = process.env[k]; if(!v){ console.error(`Missing env ${k}`); process.exit(2); } return v; }

// The OptiSpaces dashboard signs in with Amplify "CUSTOM_WITH_SRP" (Cognito CUSTOM_AUTH that
// starts with SRP). Try that first, then plain SRP, with the email trimmed and lower-cased.
function loginOnce(username, password, flow){
  const user = new CognitoUser({ Username: username, Pool: new CognitoUserPool(POOL) });
  user.setAuthenticationFlowType(flow);
  return new Promise((resolve, reject) => user.authenticateUser(
    new AuthenticationDetails({ Username: username, Password: password }),
    {
      onSuccess: s => resolve(s.getIdToken().getJwtToken()),
      onFailure: reject,
      customChallenge: p => reject(new Error(`Spintly asked for an extra sign-in step (${JSON.stringify(p||{}).slice(0,120)}) — use a login without OTP`)),
      newPasswordRequired: () => reject(new Error("Spintly asks this user to set a new password — log in once on the dashboard first")),
      mfaRequired: () => reject(new Error("This Spintly user has OTP/MFA on — use a user without MFA")),
      totpRequired: () => reject(new Error("This Spintly user has OTP/MFA on — use a user without MFA")),
    }));
}
async function login(email, password){
  const raw = String(email).trim(), lower = raw.toLowerCase();
  const tries = [[lower,"CUSTOM_AUTH"],[lower,"USER_SRP_AUTH"]];
  if(raw !== lower) tries.push([raw,"CUSTOM_AUTH"],[raw,"USER_SRP_AUTH"]);
  let last;
  for(const [u, flow] of tries){
    try{ const t = await loginOnce(u, String(password).replace(/[\r\n]+$/,""), flow); console.log(`Spintly sign-in flow: ${flow}`); return t; }
    catch(e){ last = e; console.log(`  sign-in via ${flow}${u===raw&&raw!==lower?" (original case)":""}: ${e.code||""} ${e.message}`); if(/MFA|OTP|new password|extra sign-in/.test(e.message)) break; }
  }
  throw last;
}

// READ-ONLY: Spintly must never be changed by this script. These are the only two
// endpoints it may call — both are search/list queries (POST only carries filters).
const READ_ONLY_PATHS = [
  `/userManagement/v1/organisations/${ORG}/users`,
  `/attendanceManagement/v2/organisations/${ORG}/attendanceData/dailySwipes`,
];
async function api(token, path, body){
  if(!READ_ONLY_PATHS.includes(path)) throw new Error(`Blocked: ${path} is not an allowed read-only Spintly endpoint`);
  const r = await fetch(API + path, { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: token }, body: JSON.stringify(body) });
  if(!r.ok) throw new Error(`${path} → HTTP ${r.status}: ${(await r.text()).slice(0,200)}`);
  return (await r.json()).message;
}

async function spintlyUsers(token){
  const out = [];
  for(let page = 1; page < 100; page++){
    const m = await api(token, `/userManagement/v1/organisations/${ORG}/users`, {
      pagination: { page, perPage: 100 },
      filters: { createdOn: null, userType: ["active"], accessExpiresAt: null, attributes: {}, terms: [], sites: [] } });
    out.push(...m.users);
    if(out.length >= (m.pagination?.total || 0) || !m.users.length) break;
  }
  return out;
}

async function dailySwipes(token, date){
  const out = [];
  for(let page = 1; page < 200; page++){
    const m = await api(token, `/attendanceManagement/v2/organisations/${ORG}/attendanceData/dailySwipes`, {
      filters: { search: {}, forDate: date }, pagination: { perPage: 100, currentPage: page } });
    out.push(...(m.dailySwipeAttendance || []));
    if(!m.pagination?.showNextButton || !(m.dailySwipeAttendance || []).length) break;
  }
  return out;
}

const hhmm = iso => iso ? new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" }).toUpperCase() : "";
const dur = s => { s = Number(s) || 0; if(!s) return ""; return `${Math.floor(s/3600)}:${String(Math.floor(s%3600/60)).padStart(2,"0")}`; };
function status(r){
  if(r.fullDayPresent) return "present";
  if(r.halfDayPresent) return "half_day";
  if((r.checkInCount || 0) > 0) return r.lastCheckOut ? "present" : "present";
  return "absent";
}
function istDate(offsetDays){ const d = new Date(Date.now() + 5.5*3600e3 - offsetDays*86400e3); return d.toISOString().slice(0,10); }
const norm = s => String(s || "").trim().toLowerCase();

async function main(){
  const dates = process.env.SYNC_DATE ? [process.env.SYNC_DATE] : [istDate(1), istDate(0)];
  const token = await login(need("SPINTLY_EMAIL"), need("SPINTLY_PASSWORD"));
  console.log("Spintly login OK");
  const sUsers = await spintlyUsers(token);
  const sById = new Map(sUsers.map(u => [u.id, u]));
  console.log(`Spintly users: ${sUsers.length}`);

  let db = null, hrms = [];
  if(process.env.FIREBASE_SERVICE_ACCOUNT){
    const admin = (await import("firebase-admin")).default;
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
    db = admin.firestore();
    hrms = (await db.collection("employees").get()).docs.map(d => ({ id: d.id, ...d.data() }));
    console.log(`HRMS employees: ${hrms.length}`);
  } else if(!DRY){ need("FIREBASE_SERVICE_ACCOUNT"); }

  // ---- auto-created placeholder employees (doc id spintly_<orgUserId>, no HRMS login) ----
  // Once HR creates a real employee (with login) carrying the same employee code or email,
  // the placeholder's attendance is moved to the real employee and the placeholder removed.
  const isPh = e => e.id.startsWith("spintly_");
  if(db && !DRY){
    for(const ph of hrms.filter(isPh)){
      const real = (ph.mergedInto && hrms.find(e => e.id === ph.mergedInto)) || hrms.find(e => !isPh(e) && ((ph.employeeId && norm(e.employeeId) === norm(ph.employeeId)) || (ph.email && norm(e.email) === norm(ph.email))));
      if(!real) continue;
      const att = await db.collection("attendance").where("employeeId","==",ph.id).get();
      for(const d of att.docs){
        const data = d.data();
        const ref = db.collection("attendance").doc(`${real.id}_${data.date}`);
        if(!(await ref.get()).exists) await ref.set({ ...data, employeeId: real.id });
        await d.ref.delete();
      }
      await db.collection("employees").doc(ph.id).delete();
      console.log(`Merged placeholder ${ph.name} (${ph.employeeId||ph.email}) into real employee ${real.name}: ${att.size} attendance records moved`);
    }
    hrms = (await db.collection("employees").get()).docs.map(d => ({ id: d.id, ...d.data() }));
  }
  // real employees win over placeholders when both match
  const sorted = [...hrms.filter(isPh), ...hrms.filter(e => !isPh(e))];
  const byEmail = new Map(sorted.filter(e=>e.email).map(e => [norm(e.email), e]));
  const byCode = new Map(sorted.filter(e=>e.employeeId).map(e => [norm(e.employeeId), e]));  // HRMS 'Employee ID' = Spintly employee code
  const byName = new Map(sorted.filter(e=>e.name).map(e => [norm(e.name), e]));

  let created = 0;
  for(const su of sUsers){
    if(byEmail.get(norm(su.email)) || byCode.get(norm(su.employeeCode)) || byName.get(norm(su.name))) continue;
    const ph = {
      id: `spintly_${su.id}`, name: (su.name || "").trim(), email: su.email || "", phone: su.phone || "",
      employeeId: su.employeeCode || "", role: "employee", status: "active", companyId: "",
      source: "spintly", spintlyUserId: su.id, noLogin: true, createdBy: "spintly-sync", createdAt: new Date().toISOString(),
    };
    if(db && !DRY){ const { id, ...data } = ph; await db.collection("employees").doc(id).set(data, { merge: true }); }
    if(ph.email) byEmail.set(norm(ph.email), ph);
    if(ph.employeeId) byCode.set(norm(ph.employeeId), ph);
    if(ph.name) byName.set(norm(ph.name), ph);
    created++;
  }
  if(created) console.log(`${DRY ? "Would create" : "Created"} ${created} HRMS employee record(s) from Spintly (no login yet — HR completes details)`);

  for(const date of dates){
    const rows = await dailySwipes(token, date);
    let written = 0; const unmatched = [];
    for(const r of rows){
      const su = sById.get(r.orgUserId) || {};
      const emp = byEmail.get(norm(su.email)) || byCode.get(norm(r.employeeCode || su.employeeCode)) || byName.get(norm(r.name));
      if(!emp){ unmatched.push(`${r.name}${r.employeeCode?` (${r.employeeCode})`:""}`); continue; }
      const rec = {
        employeeId: emp.id, date,
        firstEntry: hhmm(r.firstCheckIn), lastExit: hhmm(r.lastCheckOut), recentEntry: hhmm(r.lastCheckIn),
        hoursIn: dur(r.secondsInOffice), hoursOut: dur(r.secondsOutsideOffice), totalHours: dur(r.totalSecondsInOffice || r.secondsInOffice),
        status: status(r), overtimeMin: Math.round((r.overtimeSeconds || 0) / 60),
        remark: [r.lateEntry ? "Late entry" : "", r.earlyExit ? "Early exit" : "", (r.checkInCount && !r.lastCheckOut) ? "Not checked-out" : "", r.regularisationComment || ""].filter(Boolean).join(" · "),
        source: "spintly", spintlyStatus: r.attendanceStatus || "", spintlyUserId: r.orgUserId, syncedAt: new Date().toISOString(),
      };
      if(db && !DRY){
        const ref = db.collection("attendance").doc(`${emp.id}_${date}`);
        const cur = await ref.get();
        if(cur.exists && cur.data().source && cur.data().source !== "spintly") continue; // keep manual / regularised edits
        await ref.set(rec, { merge: true });
      }
      written++;
    }
    console.log(`${date}: ${rows.length} Spintly rows, ${written} ${DRY ? "matched (dry run)" : "written"}, ${unmatched.length} unmatched`);
    if(unmatched.length) console.log("  Unmatched (add the same email or employee code in HRMS): " + unmatched.join(", "));
  }
}
main().catch(e => { console.error("SYNC FAILED:", e.message || e); process.exit(1); });
