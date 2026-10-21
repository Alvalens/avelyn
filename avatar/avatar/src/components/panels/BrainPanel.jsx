import { useEffect, useState } from 'react';
import { brainProviders, modelChoices } from '../../config/brain';
import { PanelSelect } from '../ui/PanelPrimitives';

const NOTES = {
  agy: 'Needs the avelyn-engine MCP server registered once with `agy mcp add` (see engine/README.md).',
  claude: 'Log in once by running `claude` in a terminal. Runs isolated from your own Claude Code setup.',
  codex: 'Log in once with `codex login`. Runs through `codex app-server`.',
};

/**
 * Settings → Brain: which agent CLI runs her session, and on which model.
 * Changing either starts a new conversation, and she greets again.
 *
 * @param {{
 *   settings: import('../../config/brain').BrainSettings,
 *   onChange: (next: import('../../config/brain').BrainSettings) => void,
 *   listModels: (provider: string) => Promise<{ models: { id: string, label: string }[], error: string | null }>,
 * }} props
 */
export function BrainPanel({ settings, onChange, listModels }) {
  const [listed, setListed] = useState({ provider: null, models: [], error: null });

  useEffect(() => {
    let cancelled = false;
    setListed({ provider: settings.provider, models: [], error: null });
    void listModels(settings.provider).then((result) => {
      if (!cancelled) setListed({ provider: settings.provider, ...result });
    });
    return () => {
      cancelled = true;
    };
    // listModels is stable in effect (it only forwards to IPC); the provider is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.provider]);

  const loading = listed.provider !== settings.provider || (!listed.models.length && !listed.error);

  return (
    <div className="brain-panel">
      <p className="panel-note panel-note--compact">
        The agent CLI she thinks with. Switching starts a new conversation; her memories stay.
      </p>

      <label className="field-label" htmlFor="brain-provider">
        Agent
      </label>
      <PanelSelect
        id="brain-provider"
        value={settings.provider}
        options={brainProviders.map((p) => ({ value: p.id, label: p.label }))}
        // A model belongs to the CLI it was picked for.
        onChange={(provider) => provider !== settings.provider && onChange({ provider, model: '' })}
      />
      <p className="panel-note panel-note--compact">{NOTES[settings.provider]}</p>

      <label className="field-label" htmlFor="brain-model">
        Model
      </label>
      <PanelSelect
        id="brain-model"
        value={settings.model}
        options={modelChoices(listed.models, settings.model)}
        onChange={(model) => model !== settings.model && onChange({ ...settings, model })}
      />
      {loading ? <p className="panel-note panel-note--compact">Asking the CLI for its models…</p> : null}
      {listed.error ? <p className="panel-note panel-note--compact">{listed.error}</p> : null}
    </div>
  );
}
