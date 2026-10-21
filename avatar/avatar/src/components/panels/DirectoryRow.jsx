import { FolderOpen } from 'lucide-react';
import { PanelSelect } from '../ui/PanelPrimitives';

const SOURCE_OPTIONS = [
  { value: 'default', label: 'Default' },
  { value: 'custom', label: 'Custom' },
];

/**
 * One folder source (built-in or a folder of your own), shown inside the
 * Appearance section it feeds: Avatars or Environments.
 */
export function DirectoryRow({
  label,
  hint,
  source,
  onModeChange,
  onBrowse,
  onOpen,
  onClear,
  options = SOURCE_OPTIONS,
}) {
  const isCustom = source?.mode === 'custom' && Boolean(source?.path);

  return (
    <div className="directories-row">
      <div className="directories-row__head">
        <span className="directories-row__label">{label}</span>
        <span className="directories-row__hint">{hint}</span>
      </div>

      <PanelSelect
        value={isCustom ? 'custom' : 'default'}
        onChange={(value) => onModeChange?.(value)}
        options={options.map((option) => ({
          value: option.value,
          label: option.label,
          disabled: Boolean(option.disabled),
        }))}
        placeholder="Source"
      />

      {isCustom && (
        <>
          <p className="panel-note panel-note--compact panel-note--mono directories-row__path" title={source.path}>
            {source.path}
          </p>
          <div className="panel-actions directories-row__actions">
            <button type="button" className="panel-button" onClick={onBrowse}>
              Change folder
            </button>
            <button type="button" className="panel-button" onClick={onOpen} title="Open folder">
              <FolderOpen size={15} />
              Open
            </button>
            <button type="button" className="panel-button panel-button--danger" onClick={onClear}>
              Reset
            </button>
          </div>
        </>
      )}
    </div>
  );
}
