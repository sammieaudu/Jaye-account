"use client";
import {
  Children,
  isValidElement,
  useState,
  type ReactNode,
  type SelectHTMLAttributes,
  type ChangeEvent,
} from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";

type Option = { value: string; label: ReactNode; disabled?: boolean };
function optionsFrom(children: ReactNode): Option[] {
  return Children.toArray(children).flatMap((child) => {
    if (
      !isValidElement<{
        value?: string | number;
        children?: ReactNode;
        disabled?: boolean;
      }>(child)
    )
      return [];
    if (child.type === "option")
      return [
        {
          value: String(child.props.value ?? child.props.children ?? ""),
          label: child.props.children,
          disabled: child.props.disabled,
        },
      ];
    return optionsFrom(child.props.children);
  });
}
/** Shared, keyboard-accessible menu with native form submission support. */
export default function Select({
  children,
  value,
  defaultValue,
  onChange,
  name,
  required,
  disabled,
  id,
  className,
  style,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  const options = optionsFrom(children);
  const [localValue, setLocalValue] = useState(
    String(defaultValue ?? options[0]?.value ?? ""),
  );
  const selected = value === undefined ? localValue : String(value);
  const empty = options.find((option) => option.value === "");
  return (
    <SelectPrimitive.Root
      value={selected}
      name={name}
      required={required}
      disabled={disabled}
      onValueChange={(next) => {
        const actual = next === "__jaye_empty__" ? "" : next;
        setLocalValue(actual);
        onChange?.({
          target: { value: actual, name },
          currentTarget: { value: actual, name },
        } as ChangeEvent<HTMLSelectElement>);
      }}
    >
      <SelectPrimitive.Trigger
        id={id}
        className={`jaye-select ${className || ""}`}
        style={style}
        aria-label={props["aria-label"]}
        aria-labelledby={props["aria-labelledby"]}
        aria-describedby={props["aria-describedby"]}
        aria-invalid={props["aria-invalid"]}
      >
        <SelectPrimitive.Value
          placeholder={empty?.label ?? "Select an option"}
        />
        <SelectPrimitive.Icon className="jaye-select-icon">
          <ChevronDown size={16} />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          className="jaye-select-menu"
          position="popper"
          sideOffset={6}
          collisionPadding={12}
          onEscapeKeyDown={(event) => event.stopPropagation()}
        >
          <SelectPrimitive.ScrollUpButton className="jaye-select-scroll">
            <ChevronUp size={16} />
          </SelectPrimitive.ScrollUpButton>
          <SelectPrimitive.Viewport className="jaye-select-options">
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={option.value || "__jaye_empty__"}
                disabled={option.disabled}
                className="jaye-select-option"
              >
                <SelectPrimitive.ItemText>
                  {option.label}
                </SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator className="jaye-select-check">
                  <Check size={16} />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
          <SelectPrimitive.ScrollDownButton className="jaye-select-scroll">
            <ChevronDown size={16} />
          </SelectPrimitive.ScrollDownButton>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
