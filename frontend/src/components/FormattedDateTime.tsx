import { memo } from "react";
import HoverCard from "./HoverCard";
import DateTimeHoverCard from "./DateTimeHoverCard";
import { useDateTimeFormat } from "../hooks/useDateTimeFormat";
import { useSettings } from "../hooks/useSettings";

interface Props {
  value?: Date | string | null;
  label?: string;
  fallback?: string;
  className?: string;
}

const FormattedDateTime = memo(function FormattedDateTime({ value, label, fallback = "—", className }: Props) {
  const { data: settings } = useSettings();
  const formatDateTime = useDateTimeFormat();
  const showCards = settings?.show_datetime_hover_cards ?? true;

  if (!value) return <span className={className}>{fallback}</span>;

  const text = formatDateTime(value, fallback);
  const node = <span className={className}>{text}</span>;

  if (!showCards) return node;

  return (
    <HoverCard width={264} render={() => <DateTimeHoverCard value={value} label={label || "Date & time"} />}>
      {node}
    </HoverCard>
  );
});

export default FormattedDateTime;