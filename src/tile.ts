import { LETTER_VALUES, TILE_SIZE } from './constants.ts'
import type { Letter } from '../shared/letters.ts'
import type { Hand } from './hand.ts'
import type { Board } from './board.ts'
import { gridCoordsToTileHolderCoords } from './coordinates.ts'

type TileOptions = {
  id?: string;
  letter?: Letter | null;
  isBlank?: boolean;
  played?: boolean;
};

export class Tile {

  id: string;
  col: number;
  row: number;
  tileHolder: Hand | Board;
  isBGTile: boolean;
  disableDrag: (() => void) | null;
  dragAbortCallback: (() => void) | null;
  isPlayed: boolean;
  handCol: number | null;
  handRow: number | null;
  el: HTMLElement;
  letter: Letter | null;
  value: number | null;
  isBlank: boolean;

  constructor(col : number, row : number, tileHolder : Hand | Board, isBGTile : boolean = false, options: TileOptions = {}) {
    this.id = options.id ?? crypto.randomUUID();
    this.col = col;
    this.row = row;
    this.tileHolder = tileHolder;
    this.isBGTile = isBGTile;
    this.disableDrag = null;
    this.dragAbortCallback = null;

    this.isPlayed = options.played ?? false;
    this.handCol = null;
    this.handRow = null;

    this.letter = null;
    this.value = null;
    this.isBlank = Boolean(options.isBlank);

    const tileDiv = document.createElement('div');
    if (isBGTile) {
      tileDiv.classList.add('tile');
      tileDiv.classList.add('bg-tile');
      //tileDiv.textContent = '' + col + ',' + row;
    } else {
      tileDiv.classList.add('tile');
      tileDiv.classList.add('play-tile');
      tileDiv.classList.add('draggable');
      if (this.isPlayed) {
        tileDiv.classList.add('played-tile');
      }
    }
    tileDiv.style.width = TILE_SIZE + 'px';
    tileDiv.style.height = TILE_SIZE + 'px';

    const boardCoords = gridCoordsToTileHolderCoords(col, row, this.tileHolder);
    tileDiv.style.left = boardCoords.x + 'px';
    tileDiv.style.top = boardCoords.y + 'px';

    this.el = tileDiv;

    if (this.isBlank) {
      tileDiv.classList.add('blank-tile');
      this.setBlank();
    }

    if (options.letter) {
      this.setLetter(options.letter, this.isBlank);
    }

    if (!isBGTile) {
      this.disableDrag = () => {
        this.dragAbortCallback?.();
        this.el.style.cursor = '';
        this.el.classList.remove('draggable');
      }
    }

  }

  setLetter(letter : Letter, isBlank = false) {
    this.letter = letter;
    this.isBlank = isBlank;
    this.el.classList.toggle('blank-tile', isBlank);
    this.el.classList.toggle('blank-tile--assigned', isBlank && this.letter !== null);
    this.el.textContent = '';
    this.el.textContent = this.letter;

    const valueDiv = document.createElement('div');
    valueDiv.classList.add('tile-value');
    valueDiv.textContent = String(isBlank ? 0 : LETTER_VALUES[letter]);
    this.el.appendChild(valueDiv);

    this.value = isBlank ? 0 : LETTER_VALUES[letter] || 0;
  }

  setBlank() {
    this.letter = null;
    this.isBlank = true;
    this.value = 0;
    this.el.classList.add('blank-tile');
    this.el.classList.remove('blank-tile--assigned');
    this.el.textContent = '';
    const blankMark = document.createElement('div');
    blankMark.classList.add('blank-tile-mark');
    blankMark.textContent = '?';
    const valueDiv = document.createElement('div');
    valueDiv.classList.add('tile-value');
    valueDiv.textContent = '0';
    this.el.append(blankMark, valueDiv);
  }

  animatePlacement() {
    this.el.classList.remove('tile-drop');
    void this.el.offsetWidth;
    this.el.classList.add('tile-drop');
  }

  animateBump(deltaX: number, deltaY: number) {
    this.el.classList.remove('tile-bump');
    this.el.style.setProperty('--tile-bump-x', `${deltaX}px`);
    this.el.style.setProperty('--tile-bump-y', `${deltaY}px`);
    void this.el.offsetWidth;
    this.el.classList.add('tile-bump');
  }

}
