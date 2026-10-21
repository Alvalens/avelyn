/**
 * Settings → Vision: her eyes, and whether she may speak first. Timings and
 * the blocklist live in config.yaml's `vision:` section (see vision/README.md).
 *
 * @param {{
 *   settings: import('../../config/vision').VisionSettings,
 *   onChange: (next: import('../../config/vision').VisionSettings) => void,
 * }} props
 */
export function VisionPanel({ settings, onChange }) {
  const toggle = (key) => onChange({ ...settings, [key]: !settings[key] });

  return (
    <div className="vision-panel">
      <p className="panel-note panel-note--compact">
        She can take a screenshot when you ask her to look, and now and then say something
        unprompted. Screenshots stay on this machine in vision/captures (the newest 50), and
        are only sent to the model when she opens one. She won't capture while a password
        manager, banking or private window is in front. Only the window in front is checked,
        so something visible beside it, or on another monitor, is still in the picture.
      </p>

      <div className="desktop-toggle-row">
        <span className="settings-section-title">Let her see the screen</span>
        <input
          type="checkbox"
          className="panel-checkbox"
          checked={settings.enabled}
          onChange={() => toggle('enabled')}
        />
      </div>

      <div className="desktop-toggle-row">
        <span className="settings-section-title">Let her speak first</span>
        <input
          type="checkbox"
          className="panel-checkbox"
          checked={settings.initiative}
          disabled={!settings.enabled}
          onChange={() => toggle('initiative')}
        />
      </div>

      <div className="desktop-toggle-row">
        <span className="settings-section-title">Let her look on her own</span>
        <input
          type="checkbox"
          className="panel-checkbox"
          checked={settings.lookOnItsOwn}
          disabled={!settings.enabled || !settings.initiative}
          onChange={() => toggle('lookOnItsOwn')}
        />
      </div>
    </div>
  );
}
