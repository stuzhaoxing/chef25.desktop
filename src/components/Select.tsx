import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown } from "lucide-react";
import Button from "./Button";

export default function Select({
  id,
  labelId,
  value,
  options,
  onChange,
}: {
  id: string;
  labelId: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const selected = Math.max(0, options.indexOf(value));
  const listId = `${id}-options`;

  useEffect(() => {
    if (!open) return;
    function dismiss(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);

  useEffect(() => {
    if (open)
      document
        .getElementById(`${listId}-${active}`)
        ?.scrollIntoView({ block: "nearest" });
  }, [open, active, listId]);

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp":
        event.preventDefault();
        setActive(
          open
            ? (active + (event.key === "ArrowDown" ? 1 : -1) + options.length) %
                options.length
            : selected,
        );
        setOpen(true);
        break;
      case "Home":
      case "End":
        event.preventDefault();
        setActive(event.key === "Home" ? 0 : options.length - 1);
        setOpen(true);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        if (open) {
          onChange(options[active]);
          setOpen(false);
        } else {
          setActive(selected);
          setOpen(true);
        }
        break;
      case "Escape":
        if (open) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
        }
        break;
      case "Tab":
        setOpen(false);
        break;
    }
  }

  return (
    <div
      className="custom-select"
      ref={root}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <Button
        id={id}
        className="custom-select-trigger"
        role="combobox"
        aria-labelledby={`${labelId} ${id}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        onKeyDown={handleKeyDown}
        onClick={() => {
          setActive(selected);
          setOpen(!open);
        }}
      >
        <span>{value}</span>
        <ChevronDown size={16} aria-hidden="true" />
      </Button>
      {open && (
        <div
          id={listId}
          className="custom-select-menu"
          role="listbox"
          aria-labelledby={labelId}
        >
          {options.map((option, index) => (
            <div
              id={`${listId}-${index}`}
              key={option}
              role="option"
              aria-selected={option === value}
              className={`custom-select-option${index === active ? " is-active" : ""}`}
              onPointerMove={() => setActive(index)}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => {
                onChange(option);
                setOpen(false);
              }}
            >
              <span>{option}</span>
              {option === value && <Check size={16} aria-hidden="true" />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
