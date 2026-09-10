// Deterministic build patch for profilePicture timeout in messages.upsert
const fs = require('fs');
const { execSync } = require('child_process');

const mainPath = '/evolution/dist/main.js';
if (!fs.existsSync(mainPath)) {
    console.error('BUILD ERROR: /evolution/dist/main.js does not exist.');
    process.exit(1);
}

let content = fs.readFileSync(mainPath, 'utf8');

// Target 1: wrapper in WhatsApp service
const t1 = 'async profilePicture(e){let t=G(e);try{let o=await this.client.profilePictureUrl(t,"image");return{wuid:t,profilePictureUrl:o}}catch{return{wuid:t,profilePictureUrl:null}}}';
const r1 = 'async profilePicture(e,timeoutMs){let t=G(e);try{let o=await this.client.profilePictureUrl(t,"image",timeoutMs);return{wuid:t,profilePictureUrl:o}}catch{return{wuid:t,profilePictureUrl:null}}}';

// Target 2: callsite in messages.upsert
const t2 = 'profilePicUrl:(await this.profilePicture(n.key.remoteJid)).profilePictureUrl';
const r2 = 'profilePicUrl:(await this.profilePicture(n.key.remoteJid,1500)).profilePictureUrl';

const c1 = content.split(t1).length - 1;
const c2 = content.split(t2).length - 1;

if (c1 !== 1 || c2 !== 1) {
    console.error(`BUILD ERROR: Target match assertion failed! c1=${c1} (expected 1), c2=${c2} (expected 1). Upstream bundle changed. Aborting build.`);
    process.exit(1);
}

content = content.replace(t1, r1).replace(t2, r2);
fs.writeFileSync(mainPath, content);

// Syntax validation
try {
    execSync('node -c ' + mainPath);
    console.log('BUILD SUCCESS: /evolution/dist/main.js patched and syntax validated (PASS).');
} catch (err) {
    console.error('BUILD ERROR: Syntax check failed after patching!', err);
    process.exit(1);
}
