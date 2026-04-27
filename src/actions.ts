export class Actions {
  el: HTMLDivElement;

  constructor(parent: HTMLElement, buttonLabels: string[]) {
    const actionBar = document.createElement('div');
    actionBar.classList.add('actions');

    for (const label of buttonLabels) {
      const button = document.createElement('button');
      button.classList.add('action-button');
      button.type = 'button';
      button.id = `${label}-button`;
      button.setAttribute('aria-label', actionLabel(label));
      button.title = actionLabel(label);

      const icon = document.createElement('span');
      icon.classList.add('action-button__icon');
      icon.setAttribute('aria-hidden', 'true');
      icon.innerHTML = actionIcon(label);

      const text = document.createElement('span');
      text.classList.add('action-button__text');
      text.textContent = label;

      button.append(icon, text);
      actionBar.appendChild(button);
    }

    this.el = actionBar;
    parent.appendChild(this.el);
  }
}

function actionLabel(label: string): string {
  switch (label) {
    case 'recall':
      return 'Recall tiles';
    case 'shuffle':
      return 'Shuffle rack';
    case 'play':
      return 'Play turn';
    case 'exchange':
      return 'Exchange selected tiles';
    case 'pass':
      return 'Pass turn';
    default:
      return label;
  }
}

function actionIcon(label: string): string {
  switch (label) {
    case 'recall':
      return iconSvg('<path d="M9 7H4V2"/><path d="M4.8 7A6 6 0 1 1 4 12"/>');
    case 'shuffle':
      return iconSvg('<path d="M3 5h2.3c1.2 0 2.2.6 2.9 1.6l3.6 5.2c.7 1 1.7 1.6 2.9 1.6H17"/><path d="M14 10l3 3-3 3"/><path d="M3 15h2.3c1.2 0 2.2-.6 2.9-1.6l.5-.8"/><path d="M14 2l3 3-3 3"/>');
    case 'play':
      return iconSvg('<path d="M6 4l10 6-10 6V4z"/>');
    case 'exchange':
      return iconSvg('<path d="M16 3v5h-5"/><path d="M15.2 8A6 6 0 0 0 5 5.2"/><path d="M4 17v-5h5"/><path d="M4.8 12A6 6 0 0 0 15 14.8"/>');
    case 'pass':
      return iconSvg('<path d="M4 10h12"/><path d="M11 5l5 5-5 5"/>');
    default:
      return iconSvg('<circle cx="10" cy="10" r="6"/>');
  }
}

function iconSvg(paths: string): string {
  return `<svg viewBox="0 0 20 20" focusable="false" aria-hidden="true">${paths}</svg>`;
}
