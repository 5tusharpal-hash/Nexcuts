"use client";

import { useEffect, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  countryCodes,
  defaultCountryCode,
  getCountryFlag,
} from "@/features/auth/data/country-codes";

interface CountryCodeSelectProps {
  "aria-label": string;
  disabled?: boolean;
  onValueChange: (dialCode: string) => void;
  value: string;
}

const alphabeticalCountryCodes = [...countryCodes].sort((first, second) =>
  first.name.localeCompare(second.name),
);

export function CountryCodeSelect({
  "aria-label": ariaLabel,
  disabled,
  onValueChange,
  value,
}: CountryCodeSelectProps) {
  const [selectedCountry, setSelectedCountry] = useState(
    () =>
      countryCodes.find((country) => country.dialCode === value) ??
      defaultCountryCode,
  );

  useEffect(() => {
    setSelectedCountry((current) =>
      current.dialCode === value
        ? current
        : countryCodes.find((country) => country.dialCode === value) ??
          defaultCountryCode,
    );
  }, [value]);

  return (
    <Select
      value={selectedCountry.isoCode}
      onValueChange={(isoCode) => {
        const country = countryCodes.find((option) => option.isoCode === isoCode);
        if (!country) return;
        setSelectedCountry(country);
        onValueChange(country.dialCode);
      }}
      disabled={disabled}
    >
      <SelectTrigger aria-label={ariaLabel} className="w-auto shrink-0 px-2">
        <SelectValue>
          <span className="flex items-center gap-2">
            <span aria-hidden="true">
              {getCountryFlag(selectedCountry.isoCode)}
            </span>
            <span>{selectedCountry.dialCode}</span>
          </span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent
        align="start"
        className="w-max max-w-[calc(100vw-2rem)] max-h-72"
      >
        {alphabeticalCountryCodes.map((country) => (
          <SelectItem
            key={country.isoCode}
            textValue={`${country.name} ${country.isoCode} ${country.dialCode}`}
            value={country.isoCode}
          >
            <span className="flex items-center gap-2">
              <span aria-hidden="true">{getCountryFlag(country.isoCode)}</span>
              <span className="ml-auto text-text-muted">{country.dialCode}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
