import { useState } from "react";
import { Button, Calendar, Popover, TimeField } from "@heroui/react";
import { CalendarDate, Time } from "@internationalized/date";
import { CalendarBlankIcon } from "@phosphor-icons/react";
import { mergeDate, mergeTime, nowValue, parseDateParts, parseTimeParts, type DateColumnType } from "../../../lib/dateValue";

interface DateValuePickerProps {
  column: DateColumnType;
  value: string;
  onChange: (value: string) => void;
  onOpenChange?: (open: boolean) => void;
}

const buttonClass = "h-5 min-w-0 shrink-0 px-1 text-[10px] text-muted hover:text-foreground";

export function DateValuePicker({ column, value, onChange, onOpenChange }: DateValuePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const date = parseDateParts(value);
  const time = parseTimeParts(value, column.kind);
  const label = column.kind === "time" ? "Pick time" : "Pick date";

  const setOpen = (open: boolean) => {
    setIsOpen(open);
    onOpenChange?.(open);
  };

  return (
    <>
      <Popover isOpen={isOpen} onOpenChange={setOpen}>
        <Button isIconOnly size="sm" variant="ghost" aria-label={label} className={buttonClass}>
          <CalendarBlankIcon size={12} />
        </Button>
        <Popover.Content placement="bottom end">
          <Popover.Dialog aria-label={label} className="flex flex-col items-center gap-2 p-2">
            {column.kind !== "time" && (
              <Calendar
                aria-label="Date"
                value={date ? new CalendarDate(date.year, date.month, date.day) : null}
                onChange={(picked) => {
                  onChange(mergeDate(value, column, picked));
                  if (column.kind === "date") setOpen(false);
                }}
              >
                <Calendar.Header>
                  <Calendar.Heading />
                  <Calendar.NavButton slot="previous" />
                  <Calendar.NavButton slot="next" />
                </Calendar.Header>
                <Calendar.Grid>
                  <Calendar.GridHeader>{(day) => <Calendar.HeaderCell>{day}</Calendar.HeaderCell>}</Calendar.GridHeader>
                  <Calendar.GridBody>{(day) => <Calendar.Cell date={day} />}</Calendar.GridBody>
                </Calendar.Grid>
              </Calendar>
            )}
            {column.kind !== "date" && (
              <TimeField
                aria-label="Time"
                granularity="second"
                hourCycle={24}
                value={time ? new Time(time.hour, time.minute, time.second) : null}
                onChange={(picked) => picked && onChange(mergeTime(value, column, picked))}
              >
                <TimeField.Group>
                  <TimeField.Input>{(segment) => <TimeField.Segment segment={segment} />}</TimeField.Input>
                </TimeField.Group>
              </TimeField>
            )}
          </Popover.Dialog>
        </Popover.Content>
      </Popover>
      <Button size="sm" variant="ghost" className={buttonClass} onPress={() => onChange(nowValue(column))}>
        Now
      </Button>
    </>
  );
}
