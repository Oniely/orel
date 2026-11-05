export interface TableClick {
  name: string;
  /** Cmd (macOS) / Ctrl held: toggle this table in the selection */
  toggle: boolean;
  /** Shift held: select the range from the anchor to this table */
  range: boolean;
}

export interface TableSelection {
  selected: string[];
  anchor: string | null;
}

// `order` is the sidebar's visible table order, used for shift-click ranges.
export function nextTableSelection(current: TableSelection, click: TableClick, order: string[]): TableSelection {
  const { name } = click;
  if (click.range && current.anchor && order.includes(current.anchor)) {
    const [from, to] = [order.indexOf(current.anchor), order.indexOf(name)].sort((a, b) => a - b);
    return { selected: order.slice(from, to + 1), anchor: current.anchor };
  }
  if (click.toggle) {
    const selected = current.selected.includes(name)
      ? current.selected.filter((n) => n !== name)
      : [...current.selected, name];
    return { selected, anchor: name };
  }
  return { selected: [name], anchor: name };
}
