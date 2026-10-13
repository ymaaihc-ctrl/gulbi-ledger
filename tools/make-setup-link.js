// 친구에게 보낼 설정 링크를 만든다. 계획 금액은 URL 해시(#)에만 담겨 서버로 전송되지 않는다.
// 사용법: node tools/make-setup-link.js <계획 JSON 경로> <앱 주소>
import { readFileSync } from 'node:fs';

const [file, base = 'http://localhost:8765/'] = process.argv.slice(2);
if (!file) { console.error('사용법: node tools/make-setup-link.js private/friend-plan.json https://<앱 주소>/'); process.exit(1); }
const data = JSON.parse(readFileSync(file, 'utf8'));
const b64 = Buffer.from(JSON.stringify(data), 'utf8').toString('base64url');
console.log(`${base.replace(/\/?$/, '/')}#setup=${b64}`);
