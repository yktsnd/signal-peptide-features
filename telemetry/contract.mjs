import contract from './contract.json' with { type: 'json' };
export { contract };
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const SECRET = /^[0-9a-f]{64}$/;
export function validateEvent(value, now = Date.now()) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('invalid event');
  const permitted = ['id','session','seq','at','schema','ui','event','target','props'];
  if (Object.keys(value).some(k => !permitted.includes(k))) throw Error('unknown field');
  if (!UUID.test(value.id) || !UUID.test(value.session) || value.schema !== contract.schema_version || value.ui !== contract.ui_version) throw Error('invalid envelope');
  if (!Number.isInteger(value.seq) || value.seq < 1 || value.seq > 1000000 || !Number.isInteger(value.at) || value.at < now - 86400000 || value.at > now + 300000) throw Error('invalid clock');
  if (!contract.events.includes(value.event) || !contract.targets.includes(value.target)) throw Error('unknown action');
  if (!value.props || typeof value.props !== 'object' || Array.isArray(value.props) || Object.keys(value.props).length > 20) throw Error('invalid properties');
  const props = {};
  for (const [k,v] of Object.entries(value.props)) {
    if (contract.enums[k]?.includes(v)) props[k] = v;
    else if (k in contract.numeric && typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= contract.numeric[k]) props[k] = v;
    else if (contract.booleans.includes(k) && typeof v === 'boolean') props[k] = v;
    else if (k === 'control' && contract.controls?.includes(v)) props[k] = v;
    else throw Error('disallowed property');
  }
  return { ...value, props };
}
export function bucket(n) { return n <= 0 ? 'empty' : n <= 30 ? 'short' : n <= 100 ? 'medium' : n <= 1000 ? 'long' : 'very_long'; }
