import FittedSelect from "./FittedSelect";
import { MOBILE_MONEY_PROVIDERS, PAYMENT_METHODS } from "../utils/payments";

interface Props {
  method: string;
  provider: string | null;
  onSelect: (method: string, provider: string | null) => void;
  disabled?: boolean;
  ariaLabel?: string;
}

const MM = "mobile_money";
const SEP = "::";

/**
 * Single payment-method dropdown with mobile-money providers nested inline under
 * the "Mobile Money" group (replaces the old separate provider field). Provider
 * values are encoded as `${MM}${SEP}${provider}` when selected.
 */
export default function PaymentMethodPicker({ method, provider, onSelect, disabled, ariaLabel = "Payment method" }: Props) {
  const value = method === MM && provider ? `${MM}${SEP}${provider}` : method;

  const handleChange = (v: string) => {
    if (v.startsWith(`${MM}${SEP}`)) {
      onSelect(MM, v.slice(MM.length + SEP.length));
    } else {
      onSelect(v, null);
    }
  };

  return (
    <FittedSelect
      ariaLabel={ariaLabel}
      value={value}
      onChange={handleChange}
      disabled={disabled}
      options={[
        ...PAYMENT_METHODS.filter((m) => m.value !== MM).map((m) => ({ value: m.value, label: m.label })),
        {
          value: MM,
          label: "Mobile Money",
          children: MOBILE_MONEY_PROVIDERS.map((p) => ({ value: `${MM}${SEP}${p.value}`, label: p.label })),
        },
      ]}
    />
  );
}