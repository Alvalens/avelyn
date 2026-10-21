import { useEffect, useState } from 'react';
import {
  AppWindow,
  Camera,
  ChevronLeft,
  Clapperboard,
  Mic,
  Moon,
  Palette,
  Pin,
  Settings,
  X,
} from 'lucide-react';
import { animationCatalog, getSelectableAnimations } from '../../config/animations';
import { isIdleAnimation } from '../../config/idlePool';
import { isDesktopMode } from '../../lib/desktopMode';

const ICON = 15;
const STROKE = 2;

/**
 * Group entries by their `group`, in the order each group is first seen, so a
 * folder with a `poses/` subfolder reads as sections rather than one long flat
 * list. Entries with no group fall under a single unlabelled first section.
 * @param {{ group?: string }[]} entries
 */
function groupAnimations(entries) {
  const groups = [];
  const byName = new Map();

  for (const entry of entries) {
    const name = entry.group ?? '';
    let group = byName.get(name);
    if (!group) {
      group = { name, entries: [] };
      byName.set(name, group);
      groups.push(group);
    }
    group.entries.push(entry);
  }

  return groups;
}

function CommandButton({ label, pressed, onClick, children, variant = 'default', style }) {
  return (
    <button
      type="button"
      className={`avatar-command-menu__btn ${variant === 'close' ? 'avatar-command-menu__btn--close' : ''} ${pressed ? 'avatar-command-menu__btn--active' : ''}`}
      aria-label={label}
      aria-pressed={pressed}
      onClick={onClick}
      style={style}
    >
      {children}
      <span className="avatar-command-menu__tooltip">{label}</span>
    </button>
  );
}

export function BarCommandMenu({
  open,
  openPanel,
  animationId,
  animations: catalog = animationCatalog,
  idlePool = [],
  onToggleIdle,
  overlayMode,
  onOpenPanel,
  onAnimationChange,
  onOverlayModeToggle,
  onCloseWindow,
  onCloseMenu,
}) {
  const [view, setView] = useState('main');
  // Which row's right-click menu is open, if any.
  const [idleMenuId, setIdleMenuId] = useState(null);
  const desktopMode = isDesktopMode();
  const animations = getSelectableAnimations(catalog);

  useEffect(() => {
    if (!open) setView('main');
  }, [open]);

  useEffect(() => {
    if (view !== 'animations') setIdleMenuId(null);
  }, [view]);

  if (!open) return null;

  function openDrawer(panelId) {
    onOpenPanel(panelId);
    onCloseMenu();
  }

  function runAndClose(action) {
    action();
    onCloseMenu();
  }

  if (view === 'animations') {
    // Continues across groups so the stagger reads as one list opening.
    let row = 0;

    return (
      <div className="avatar-command-menu avatar-command-menu--animations" role="menu">
        <CommandButton
          label="Back"
          onClick={() => setView('main')}
          style={{ animationDelay: '0ms' }}
        >
          <ChevronLeft size={ICON} strokeWidth={STROKE} />
        </CommandButton>
        {groupAnimations(animations).map((group) => (
          // `display: contents` — the rows stay direct flex items of the menu,
          // so the column-reverse stack and its stagger are unchanged. The
          // heading comes after its entries in the DOM for that same reason:
          // reversed, that puts it visually above the section it names.
          <div key={group.name || 'ungrouped'} className="avatar-command-menu__group">
            {group.entries.map((entry) => {
              row += 1;
              const isIdle = isIdleAnimation(idlePool, entry.id);
              return (
                <div key={entry.id} className="avatar-command-menu__anim-row">
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={animationId === entry.id}
                    className={`avatar-command-menu__anim ${animationId === entry.id ? 'avatar-command-menu__anim--active' : ''}`}
                    style={{ animationDelay: `${row * 35}ms` }}
                    onClick={() => runAndClose(() => onAnimationChange(entry.id))}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setIdleMenuId((current) => (current === entry.id ? null : entry.id));
                    }}
                  >
                    <span className="avatar-command-menu__anim-label">{entry.label}</span>
                    {isIdle && (
                      <Moon
                        size={11}
                        strokeWidth={2.5}
                        className="avatar-command-menu__anim-idle"
                        aria-label="In the idle pool"
                      />
                    )}
                  </button>
                  {idleMenuId === entry.id && (
                    <div className="avatar-command-menu__context" role="menu">
                      <button
                        type="button"
                        role="menuitem"
                        className="avatar-command-menu__context-item"
                        onClick={() => {
                          onToggleIdle?.(entry.id);
                          setIdleMenuId(null);
                        }}
                      >
                        {isIdle ? 'Remove from idle' : 'Set as idle'}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
            {group.name && (
              <p className="avatar-command-menu__group-title">{group.name}</p>
            )}
          </div>
        ))}
      </div>
    );
  }

  const pinLabel = overlayMode ? 'Pinned (Switch to Windowed)' : 'Windowed (Switch to Pinned)';

  const items = [
    {
      label: 'Appearance',
      icon: <Palette size={ICON} strokeWidth={STROKE} />,
      pressed: openPanel === 'palette',
      onClick: () => openDrawer('palette'),
    },
    {
      label: 'Voice',
      icon: <Mic size={ICON} strokeWidth={STROKE} />,
      pressed: openPanel === 'voice',
      onClick: () => openDrawer('voice'),
    },
    {
      label: 'Camera & Lighting',
      icon: <Camera size={ICON} strokeWidth={STROKE} />,
      pressed: openPanel === 'camera',
      onClick: () => openDrawer('camera'),
    },
    {
      label: 'Animations',
      icon: <Clapperboard size={ICON} strokeWidth={STROKE} />,
      pressed: false,
      onClick: () => setView('animations'),
    },
  ];

  if (desktopMode) {
    items.push({
      label: pinLabel,
      icon: overlayMode ? (
        <Pin size={ICON} strokeWidth={STROKE} />
      ) : (
        <AppWindow size={ICON} strokeWidth={STROKE} />
      ),
      pressed: overlayMode,
      onClick: () => onOverlayModeToggle(),
    });
  }

  items.push({
    label: 'Settings',
    icon: <Settings size={ICON} strokeWidth={STROKE} />,
    pressed: openPanel === 'settings',
    onClick: () => openDrawer('settings'),
  });

  if (desktopMode) {
    items.push({
      label: 'Close',
      icon: <X size={ICON} strokeWidth={STROKE} />,
      pressed: false,
      variant: 'close',
      onClick: () => runAndClose(onCloseWindow),
    });
  }

  return (
    <div className="avatar-command-menu" role="menu">
      {items.map((item, index) => (
        <CommandButton
          key={item.label}
          label={item.label}
          pressed={item.pressed}
          variant={item.variant}
          style={{ animationDelay: `${index * 40}ms` }}
          onClick={item.onClick}
        >
          {item.icon}
        </CommandButton>
      ))}
    </div>
  );
}
