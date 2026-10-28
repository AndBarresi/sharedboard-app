import * as z from 'zod/v4';

export const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).refine((id) => !['__proto__', 'constructor', 'prototype'].includes(id));
const finite = z.number().finite();
export const visualSchema=z.string().regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/).max(4_000_000).refine(value=>{const encoded=value.split(',')[1];return Boolean(encoded)&&Buffer.from(encoded,'base64').subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));},'Expected a PNG image').optional();
export const specSchema = z.object({
  id: idSchema.optional(), type: z.enum(['rectangle', 'ellipse', 'diamond', 'text', 'arrow', 'line']).default('rectangle'),
  x: finite.default(0), y: finite.default(0), width: finite.min(0).max(100000).optional(), height: finite.min(0).max(100000).optional(),
  text: z.string().max(10000).optional(), fontSize: finite.min(8).max(200).optional(),
  strokeColor: z.string().max(80).optional(), backgroundColor: z.string().max(80).optional(),
  textColor: z.string().max(80).optional(),
});
export const imagineSpecSchema=specSchema.extend({id:idSchema.max(122).optional(),fontFamily:z.enum({handDrawn:1,normal:2,code:3}).default(2),strokeWidth:finite.min(0).max(12).default(1),roughness:finite.min(0).max(2).default(0),opacity:finite.min(0).max(100).default(100),corners:z.enum(['rounded','sharp']).default('rounded')});
export const replaceSelectionSchema=z.object({messageId:z.string().uuid(),elements:z.array(imagineSpecSchema).min(1).max(200),designSummary:z.string().trim().min(1).max(2000),summary:z.string().trim().min(1).max(200).default('Imagine polished the selected design')});
export const editsSchema = z.array(z.object({
  id: idSchema, expectedVersion: z.number().int().min(1),
  changes: z.object({
    x: finite.optional(), y: finite.optional(), width: finite.min(0).max(100000).optional(), height: finite.min(0).max(100000).optional(),
    text: z.string().max(10000).optional(), strokeColor: z.string().max(80).optional(),
    backgroundColor: z.string().max(80).optional(), angle: finite.optional(),
    fontSize: finite.min(8).max(200).optional(), opacity: finite.min(0).max(100).optional(),
    isDeleted: z.boolean().optional(), locked: z.boolean().optional(),
  }).strict(),
})).min(1).max(500);
export const patchSchema = z.object({
  changes: z.array(z.object({
    id: idSchema, expectedVersion: z.number().int().min(0),
    element: z.object({ id: idSchema, type: z.string().max(50), x: finite, y: finite, width: finite, height: finite }).passthrough(),
  }).refine((change) => change.id === change.element.id, 'Object IDs must match')).max(10000),
  files: z.record(idSchema, z.object({
    id: idSchema, dataURL: z.string().startsWith('data:image/').max(20_000_000), mimeType: z.string().max(100),
    created: finite, lastRetrieved: finite.optional(),
  }).passthrough()).optional(),
  summary: z.string().max(200).optional(), clientId: idSchema.optional(),
}).refine((body) => new Set(body.changes.map((change) => change.id)).size === body.changes.length, 'Duplicate object IDs');
