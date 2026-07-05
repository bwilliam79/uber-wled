import { SearchIcon, XIcon } from '../icons';

export interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
}

export function SearchInput({ value, onChange, placeholder = 'Search', label = 'Search' }: SearchInputProps) {
  return (
    <div className="ui-search">
      <SearchIcon className="ui-search-icon" />
      <input
        type="search"
        className="ui-search-input"
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value !== '' && (
        <button type="button" className="ui-search-clear" aria-label="Clear search" onClick={() => onChange('')}>
          <XIcon />
        </button>
      )}
    </div>
  );
}
