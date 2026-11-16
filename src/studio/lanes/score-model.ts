import type { SheetInput } from '../../contract';
import { makeCell, sheetModel } from '../../sheet/model';
import { instrumentDetails } from '../view-instruments';

/** Add sampled values to the shared document inventory, for this section only. */
export function scoreModel(input: SheetInput) {
  const model = sheetModel(input);
  const section = model.sections.find((section) => section.current);
  const details = instrumentDetails(input.doc);
  const answers: Partial<SheetInput['events']> = input.events;
  model.rows = model.rows.map((row) => {
    const inventory = details.get(row.id);
    const inSection = (item: { sectionId?: string }) =>
      !item.sectionId || item.sectionId === section?.nodeId;
    const settings =
      inventory?.settings.filter(inSection).map((setting) => {
        const own = row.cells.find(
          (cell) => cell.name === setting.name && cell.nodeId === setting.nodeId,
        );
        if (own) return own;
        const answer = answers[row.id];
        return makeCell(
          setting.name,
          setting.nodeId,
          answer?.error ? [] : (answer?.events ?? []),
          true,
          setting.kind === 'signal',
          row.status,
          input,
        );
      }) ?? [];
    const rewrites =
      inventory?.rewrites.filter(inSection).map((rewrite) => ({
        nodeId: rewrite.nodeId,
        name: rewrite.name,
        summary: rewrite.label,
        source: rewrite.source,
      })) ?? [];
    return {
      ...row,
      cells: [...row.cells.filter((cell) => cell.name === 'rhythm'), ...settings],
      rewrites,
    };
  });
  return model;
}
