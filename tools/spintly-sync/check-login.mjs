// Local check: does this Spintly email + password sign in? Prints only OK / the error.
// Run:  node check-login.mjs     (asks for both; nothing is saved or sent anywhere but Spintly's sign-in)
import { createInterface } from "node:readline";
import { CognitoUserPool, CognitoUser, AuthenticationDetails } from "amazon-cognito-identity-js";

const POOL = new CognitoUserPool({ UserPoolId: "ap-south-1_FJvXB4KPj", ClientId: "24lqc87njds5aqjknibohr5ero" });
const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q, hide) => new Promise(r => {
  if(hide){ const w = rl._writeToOutput; rl._writeToOutput = s => { if(s.includes(q)) w.call(rl, s); }; rl.question(q, a => { rl._writeToOutput = w; process.stdout.write("\n"); r(a); }); }
  else rl.question(q, r);
});
const email = (await ask("Spintly login email: ")).trim().toLowerCase();
const password = await ask("Spintly password (hidden): ", true);
rl.close();
for(const flow of ["CUSTOM_AUTH","USER_SRP_AUTH"]){
  const u = new CognitoUser({ Username: email, Pool: POOL }); u.setAuthenticationFlowType(flow);
  const res = await new Promise(r => u.authenticateUser(new AuthenticationDetails({ Username: email, Password: password }), {
    onSuccess: () => r("OK"), onFailure: e => r(`${e.code}: ${e.message}`),
    customChallenge: () => r("needs an extra step (OTP) — use a login without OTP"),
    mfaRequired: () => r("MFA/OTP is on for this user"), totpRequired: () => r("MFA/OTP is on for this user"),
    newPasswordRequired: () => r("must set a new password on the dashboard first") }));
  console.log(`${flow}: ${res}`);
  if(res === "OK"){ console.log(`\nLogin works. Save this exact email as SPINTLY_EMAIL: ${email}`); break; }
}
