import { GRID } from './constants.ts'

type ActionSide = 'full';

export class Actions {
  nButtons: number;
  side: ActionSide;
  buttonPad: number;
  el: HTMLDivElement;

  constructor(nButtons: number, side: ActionSide, parent: HTMLElement, buttonLabels: string[]) {
    this.nButtons = nButtons;
    this.side = side;
    this.buttonPad = GRID.pad;

    const actionBar = document.createElement('div');
    actionBar.classList.add('actions');

    for (let i = 0; i < nButtons; i++) {
      const button = document.createElement('button');
      button.classList.add('action-button');
      button.id = buttonLabels[i] + '-button';
      button.textContent = buttonLabels[i];
      actionBar.appendChild(button);
    }

    this.el = actionBar;
    parent.appendChild(this.el);

  }
}
