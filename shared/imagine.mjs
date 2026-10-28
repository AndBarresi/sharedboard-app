// Copyright (c) 2026 Andrew Barresi. SPDX-License-Identifier: MIT

// Include the contents of selected frames and editable bound labels, without
// pulling unrelated arrows into a replacement merely because they touch a box.
export function imagineSelection(elements, selectedIds = []) {
  const active = elements.filter(element => !element.isDeleted);
  const ids = new Set(selectedIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const element of active) {
      if (ids.has(element.id)) {
        for (const bound of element.boundElements ?? []) {
          if (bound.type === 'text' && !ids.has(bound.id)) { ids.add(bound.id); changed = true; }
        }
      } else if (ids.has(element.frameId) || ids.has(element.containerId)) {
        ids.add(element.id); changed = true;
      }
    }
  }
  return active.filter(element => ids.has(element.id));
}

export function previousImaginePasses(elements = []) {
  const passes = new Map();
  for (const element of elements) {
    const pass = element.customData?.sharedboardImagine;
    if (!element.isDeleted && pass?.passId && typeof pass.designSummary === 'string') passes.set(pass.passId, pass);
  }
  return [...passes.values()].slice(-8);
}

export function buildImaginePrompt({ instructions = '', designDirection = '', previousPasses = [] } = {}) {
  const earlier = previousPasses.slice(-8).map(pass => pass.designSummary?.slice(0,200)).filter(Boolean).join('\n').slice(0,800);
  instructions=instructions.slice(0,2000);designDirection=designDirection.slice(0,2000);
  return [
    'Imagine this selected wireframe or drawing as a polished, close-to-release design. Preserve its purpose, content hierarchy and intended functionality while improving spacing, typography, color, alignment and reusable visual patterns.',
    'Read this exact captured message and image, then read the current board before making changes. The selection and its frame contents are the only objects authorized for replacement. Keep the result editable on the canvas and in the same board coordinates. Do not generate or deploy an application.',
    'When this capture includes imagineReferences, its second image and elements are existing finished design references from this board. They may have been drawn by hand or imported and do not need a prior Imagine pass. Infer their typography, palette, spacing, navigation, components and visual treatment, then apply that system to the selected wireframe. The reference objects are context only and must remain unchanged.',
    designDirection ? `Project design direction:\n${designDirection}` : 'Derive a coherent design direction from the existing board, its notes and prior Imagine passes. Preserve recurring visual choices.',
    earlier ? `Prior Imagine passes to stay consistent with:\n${earlier}` : '',
    instructions ? `What to imagine:\n${instructions}` : '',
    'Use replace_selection with this messageId, the complete replacement elements and a concise designSummary of the palette, typography, spacing and repeated components. This tool replaces the captured selection atomically and checks for overlapping human changes. Do not delete and add objects in separate operations. On a conflict, stop and explain the changed selection; do not overwrite it or automatically retry.',
    'After the actual replacement succeeds, post the actual result through reply_to_chat_message for this same captured message ID. If the tool is unavailable or work fails, explain the limitation in that reply and do not claim the design was applied.',
  ].filter(Boolean).join('\n\n');
}
