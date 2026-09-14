// Download the CC0 spaceship packs the imported fleet is built from into
// .local/vendor (git-ignored). No modelling application is used; run
// tools/pack-imported-fleet.mjs afterwards to rebuild the runtime GLB.
//
//   Quaternius · Ultimate Spaceships Pack (glTF from the artist's Drive folder,
//                2048 px red/blue textures from Malcolm Nixon's CC0 port)
//   Polyy.AI   · 3D Spaceships Pack and 3D Spaceships Pack 2 (itch.io, free)
import { execFileSync } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';

const cache = '.local/vendor';
await mkdir(`${cache}/packs`, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const exists = (path) =>
  access(path).then(
    () => true,
    () => false,
  );

async function download(url, path, init) {
  if (await exists(path)) return readFile(path);
  const r = await fetch(url, init);
  if (!r.ok) throw new Error(`${r.status}: ${url}`);
  const b = Buffer.from(await r.arrayBuffer());
  await writeFile(path, b);
  return b;
}

/* --- Quaternius, public Google Drive folder --------------------------- */
function driveEntries(html) {
  const escaped = html.match(/window\['_DRIVE_ivd'\] = '([^']+)'/)[1];
  const decoded = escaped
    .replace(/\\x([0-9a-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\\//g, '/');
  return JSON.parse(decoded)[0].map((r) => ({ id: r[0], name: r[2], type: r[3] }));
}
const folder = async (id) =>
  driveEntries(
    (
      await download(`https://drive.google.com/drive/folders/${id}`, `${cache}/${id}.html`)
    ).toString(),
  );
const QUATERNIUS = [
  'Bob',
  'Challenger',
  'Dispatcher',
  'Executioner',
  'Imperial',
  'Insurgent',
  'Omen',
  'Pancake',
  'Spitfire',
  'Striker',
  'Zenith',
];
for (const ship of await folder('1NpfT3wqe2k3Jwue2xryi7tzxP4bWzETu')) {
  if (!ship.type.endsWith('folder') || !QUATERNIUS.includes(ship.name)) continue;
  let files = await folder(ship.id);
  const gltf = files.find((f) => /gltf/i.test(f.name) && f.type.endsWith('folder'));
  if (gltf) files = await folder(gltf.id);
  const model = files.find((f) => /\.gltf$/i.test(f.name));
  await download(
    `https://drive.google.com/uc?export=download&id=${model.id}`,
    `${cache}/${ship.name}.gltf`,
  );
  for (const finish of ship.name === 'Striker' ? ['Red', 'Blue'] : ['Red'])
    await download(
      `https://raw.githubusercontent.com/Malcolmnixon/Quaternius-Ultimate-Spaceships-Pack/main/addons/quaternius-ultimate-spaceships-pack/meshes/${ship.name.toLowerCase()}/textures/${ship.name}_${finish}.png`,
      `${cache}/${ship.name}_${finish}.png`,
    );
  console.log('Quaternius', ship.name);
}

/* --- Polyy.AI, free itch.io downloads ---------------------------------- */
async function itch(page, dest) {
  const jar = new Map();
  const request = async (url, init = {}) => {
    for (let attempt = 0; attempt < 6; attempt++) {
      const r = await fetch(url, {
        ...init,
        redirect: init.method === 'POST' ? 'manual' : 'follow',
        headers: {
          'user-agent': 'Mozilla/5.0 VOLTARIS asset import',
          cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
          ...init.headers,
        },
      });
      for (const c of r.headers.getSetCookie()) {
        const [pair] = c.split(';');
        jar.set(pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1));
      }
      if (r.status !== 429) return r;
      await sleep(15000 * (attempt + 1));
    }
    throw new Error(`Rate limited: ${url}`);
  };
  const form = (csrf) => ({
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-requested-with': 'XMLHttpRequest',
    },
    body: new URLSearchParams({ csrf_token: csrf }),
  });
  const csrf = (html) => html.match(/name="csrf_token" value="([^"]+)"/)[1];
  const landing = await (await request(page)).text();
  const { url } = await (await request(`${page}/download_url`, form(csrf(landing)))).json();
  const html = await (await request(url)).text();
  const ids = [...new Set([...html.matchAll(/data-upload_id="(\d+)"/g)].map((m) => m[1]))];
  const files = [];
  for (const id of ids) {
    const path = `${cache}/packs/${dest}-${id}.zip`;
    if (!(await exists(path))) {
      await sleep(2000);
      const info = await (
        await request(`${page}/file/${id}?source=game_download`, form(csrf(html)))
      ).json();
      await download(info.url, path);
    }
    files.push(path);
  }
  return files;
}
const unzip = (zip, to) => {
  execFileSync('tar', ['-xf', zip, '-C', to]);
};
await mkdir(`${cache}/packs/p1`, { recursive: true });
for (const zip of await itch('https://polyyai.itch.io/3d-spaceships-pack', 'polyy1'))
  unzip(zip, `${cache}/packs/p1`);
await mkdir(`${cache}/packs/p2`, { recursive: true });
await mkdir(`${cache}/packs/p2low`, { recursive: true });
for (const zip of await itch('https://polyyai.itch.io/3d-spaceships-pack-2', 'polyy2')) {
  const listing = execFileSync('tar', ['-tf', zip]).toString();
  unzip(zip, `${cache}/packs/${listing.includes('_low/') ? 'p2low' : 'p2'}`);
}
console.log('Polyy.AI packs ready');
