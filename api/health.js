export default function handler(req, res) {
  res.json({ ok: true, version: "v2", time: Date.now(), pid: process.pid });
}
