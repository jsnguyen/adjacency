export class Actions {
  el: HTMLDivElement;

  constructor(parent: HTMLElement, buttonLabels: string[]) {
    const actionBar = document.createElement('div');
    actionBar.classList.add('actions');

    for (const label of buttonLabels) {
      const button = document.createElement('button');
      button.classList.add('action-button');
      button.id = `${label}-button`;
      button.textContent = label;
      actionBar.appendChild(button);
    }

    this.el = actionBar;
    parent.appendChild(this.el);
  }
}
