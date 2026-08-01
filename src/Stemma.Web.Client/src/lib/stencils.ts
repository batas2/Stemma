// Curated stencil set for Epic 07 Track C.
// Inline data-URI SVGs so we don't ship a separate asset bundle. ~30 stencils across
// general / cloud / data / messaging / actor categories. Add more by following the
// (category, label, svg) pattern.

export interface Stencil {
  id: string;
  category: 'general' | 'cloud' | 'data' | 'messaging' | 'actor';
  label: string;
  src: string;          // data:image/svg+xml;utf8,...
}

function svg(viewBox: string, body: string, fill = 'currentColor'): string {
  const xml = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" fill="${fill}" stroke="${fill}" stroke-width="1.5">${body}</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(xml)}`;
}

function svgOf(body: string, fill: string): string {
  return svg('0 0 64 64', body, fill);
}

const indigo = '#6366f1';
const sky = '#0ea5e9';
const emerald = '#10b981';
const amber = '#f59e0b';
const rose = '#f43f5e';
const slate = '#64748b';

export const STENCILS: Stencil[] = [
  // ---------- General shapes ----------
  { id: 'general:user',
    category: 'actor', label: 'User',
    src: svgOf('<circle cx="32" cy="20" r="9" fill="none"/><path d="M14 54c0-10 8-18 18-18s18 8 18 18" fill="none"/>', slate) },
  { id: 'general:role',
    category: 'actor', label: 'Role',
    src: svgOf('<circle cx="32" cy="20" r="9" fill="none"/><path d="M14 54c0-10 8-18 18-18s18 8 18 18" fill="none"/><circle cx="48" cy="42" r="6" fill="none"/>', slate) },
  { id: 'general:team',
    category: 'actor', label: 'Team',
    src: svgOf('<circle cx="22" cy="22" r="8" fill="none"/><circle cx="42" cy="22" r="8" fill="none"/><path d="M8 50c0-9 6-14 14-14s14 5 14 14M28 50c0-9 6-14 14-14s14 5 14 14" fill="none"/>', slate) },

  // ---------- Data ----------
  { id: 'data:database',
    category: 'data', label: 'Database',
    src: svgOf('<ellipse cx="32" cy="14" rx="18" ry="6" fill="none"/><path d="M14 14v36c0 3 8 6 18 6s18-3 18-6V14" fill="none"/><path d="M14 26c0 3 8 6 18 6s18-3 18-6M14 38c0 3 8 6 18 6s18-3 18-6" fill="none"/>', sky) },
  { id: 'data:datalake',
    category: 'data', label: 'Data Lake',
    src: svgOf('<path d="M6 38c4-6 14-6 18 0s14 6 18 0 14-6 18 0v18H6z" fill="none"/><circle cx="22" cy="20" r="6" fill="none"/><circle cx="42" cy="14" r="4" fill="none"/>', sky) },
  { id: 'data:cache',
    category: 'data', label: 'Cache',
    src: svgOf('<rect x="10" y="14" width="44" height="36" rx="4" fill="none"/><path d="M10 26h44M10 38h44" fill="none"/>', emerald) },
  { id: 'data:object-store',
    category: 'data', label: 'Object Store',
    src: svgOf('<rect x="8" y="12" width="48" height="14" rx="2" fill="none"/><rect x="8" y="28" width="48" height="14" rx="2" fill="none"/><rect x="8" y="44" width="48" height="14" rx="2" fill="none"/><circle cx="14" cy="19" r="1.5"/><circle cx="14" cy="35" r="1.5"/><circle cx="14" cy="51" r="1.5"/>', sky) },
  { id: 'data:search-index',
    category: 'data', label: 'Search Index',
    src: svgOf('<circle cx="28" cy="28" r="14" fill="none"/><path d="M40 40l12 12" fill="none"/>', emerald) },

  // ---------- Messaging ----------
  { id: 'messaging:queue',
    category: 'messaging', label: 'Queue',
    src: svgOf('<rect x="6" y="22" width="52" height="20" rx="2" fill="none"/><path d="M14 32h-4M50 32h4" fill="none"/><circle cx="20" cy="32" r="3"/><circle cx="32" cy="32" r="3"/><circle cx="44" cy="32" r="3"/>', amber) },
  { id: 'messaging:topic',
    category: 'messaging', label: 'Topic',
    src: svgOf('<circle cx="32" cy="32" r="10" fill="none"/><path d="M32 22V8M32 56V46M22 32H8M56 32H46M22 22L12 12M52 12L42 22M22 42L12 52M52 52L42 42" fill="none"/>', amber) },
  { id: 'messaging:event-bus',
    category: 'messaging', label: 'Event Bus',
    src: svgOf('<rect x="6" y="28" width="52" height="8" rx="2" fill="none"/><circle cx="14" cy="32" r="3"/><circle cx="32" cy="32" r="3"/><circle cx="50" cy="32" r="3"/><path d="M14 28V14M32 28V14M50 28V14M14 36v14M32 36v14M50 36v14" fill="none"/>', amber) },
  { id: 'messaging:webhook',
    category: 'messaging', label: 'Webhook',
    src: svgOf('<circle cx="32" cy="32" r="8" fill="none"/><path d="M28 25l-10 17M36 25l10 17M22 42h20" fill="none"/>', amber) },

  // ---------- Cloud ----------
  { id: 'cloud:cloud',
    category: 'cloud', label: 'Cloud',
    src: svgOf('<path d="M18 42c-6 0-10-4-10-10s4-10 10-10c1-6 6-10 12-10s11 4 12 10c6 0 10 4 10 10s-4 10-10 10z" fill="none"/>', sky) },
  { id: 'cloud:lambda',
    category: 'cloud', label: 'Function',
    src: svgOf('<path d="M12 12h12l16 40h-12l-4-10h-12l-4 10h-12z" fill="none"/>', amber) },
  { id: 'cloud:api',
    category: 'cloud', label: 'API',
    src: svgOf('<rect x="8" y="14" width="48" height="36" rx="4" fill="none"/><path d="M16 24h32M16 32h32M16 40h20" fill="none"/>', emerald) },
  { id: 'cloud:cdn',
    category: 'cloud', label: 'CDN',
    src: svgOf('<circle cx="32" cy="32" r="20" fill="none"/><path d="M12 32h40M32 12c10 8 10 32 0 40M32 12c-10 8-10 32 0 40" fill="none"/>', sky) },
  { id: 'cloud:gateway',
    category: 'cloud', label: 'Gateway',
    src: svgOf('<rect x="8" y="20" width="48" height="24" rx="4" fill="none"/><path d="M16 32h32M22 26v12M42 26v12" fill="none"/>', emerald) },
  { id: 'cloud:lb',
    category: 'cloud', label: 'Load Balancer',
    src: svgOf('<rect x="22" y="8" width="20" height="14" rx="2" fill="none"/><rect x="6" y="42" width="16" height="14" rx="2" fill="none"/><rect x="24" y="42" width="16" height="14" rx="2" fill="none"/><rect x="42" y="42" width="16" height="14" rx="2" fill="none"/><path d="M32 22v6l-18 14M32 28v14M32 28l18 14" fill="none"/>', emerald) },

  // ---------- General service / system shapes ----------
  { id: 'general:service',
    category: 'general', label: 'Service',
    src: svgOf('<rect x="10" y="14" width="44" height="36" rx="6" fill="none"/><circle cx="22" cy="32" r="3"/><circle cx="32" cy="32" r="3"/><circle cx="42" cy="32" r="3"/>', indigo) },
  { id: 'general:container',
    category: 'general', label: 'Container',
    src: svgOf('<rect x="6" y="14" width="52" height="36" rx="2" fill="none"/><path d="M6 22h52" fill="none"/><circle cx="12" cy="18" r="1.5"/><circle cx="18" cy="18" r="1.5"/>', indigo) },
  { id: 'general:job',
    category: 'general', label: 'Background Job',
    src: svgOf('<circle cx="32" cy="32" r="20" fill="none"/><path d="M32 18v14l10 6" fill="none"/>', amber) },
  { id: 'general:firewall',
    category: 'general', label: 'Firewall',
    src: svgOf('<rect x="10" y="12" width="44" height="40" rx="2" fill="none"/><path d="M10 22h44M10 32h44M10 42h44M22 12v10M42 22v10M22 42v10" fill="none"/>', rose) },
  { id: 'general:doc',
    category: 'general', label: 'Document',
    src: svgOf('<path d="M14 8h28l8 8v40H14z" fill="none"/><path d="M42 8v8h8M22 28h20M22 36h20M22 44h14" fill="none"/>', slate) },
  { id: 'general:cog',
    category: 'general', label: 'Settings',
    src: svgOf('<circle cx="32" cy="32" r="6" fill="none"/><circle cx="32" cy="32" r="14" fill="none" stroke-dasharray="4 3"/>', slate) },
  { id: 'general:lock',
    category: 'general', label: 'Auth / Secret',
    src: svgOf('<rect x="14" y="28" width="36" height="26" rx="3" fill="none"/><path d="M22 28v-6c0-6 4-10 10-10s10 4 10 10v6" fill="none"/><circle cx="32" cy="40" r="3"/>', rose) },
  { id: 'general:metric',
    category: 'general', label: 'Metric',
    src: svgOf('<path d="M8 50V14M8 50h48" fill="none"/><path d="M14 42l8-10 8 6 8-14 8 4 8-12" fill="none"/>', emerald) },
  { id: 'general:log',
    category: 'general', label: 'Log Stream',
    src: svgOf('<rect x="8" y="10" width="48" height="44" rx="2" fill="none"/><path d="M16 22h32M16 30h32M16 38h24M16 46h16" fill="none"/>', slate) },
  { id: 'general:external',
    category: 'general', label: 'External System',
    src: svgOf('<rect x="6" y="14" width="52" height="36" rx="4" fill="none" stroke-dasharray="6 3"/><path d="M22 32h20M36 26l6 6-6 6" fill="none"/>', slate) },
];

export const STENCIL_CATEGORIES: Array<{ id: Stencil['category']; label: string }> = [
  { id: 'general', label: 'General' },
  { id: 'cloud', label: 'Cloud' },
  { id: 'data', label: 'Data' },
  { id: 'messaging', label: 'Messaging' },
  { id: 'actor', label: 'Actors' },
];

export function findStencil(id: string): Stencil | undefined {
  return STENCILS.find((s) => s.id === id);
}
