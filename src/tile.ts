import { LETTER_VALUES, TILE_SIZE } from './constants.ts'
import type { Letter } from './constants.ts'
import type { Hand } from './hand.ts'
import type { Board } from './board.ts'
import { gridCoordsToTileHolderCoords } from './coordinates.ts'

export class Tile {

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

  constructor(col : number, row : number, tileHolder : Hand | Board, isBGTile : boolean = false) {
    this.col = col;
    this.row = row;
    this.tileHolder = tileHolder;
    this.isBGTile = isBGTile;
    this.disableDrag = null;
    this.dragAbortCallback = null;

    this.isPlayed = false;
    this.handCol = null;
    this.handRow = null;

    this.letter = null;
    this.value = null;

    var tileDiv = document.createElement('div');
    if (isBGTile) {
      tileDiv.classList.add('tile');
      tileDiv.classList.add('bg-tile');
      //tileDiv.textContent = '' + col + ',' + row;
    } else {
      tileDiv.classList.add('tile');
      tileDiv.classList.add('play-tile');
      tileDiv.classList.add('draggable');
    }
    tileDiv.style.width = TILE_SIZE + 'px';
    tileDiv.style.height = TILE_SIZE + 'px';

    const boardCoords = gridCoordsToTileHolderCoords(col, row, this.tileHolder);
    tileDiv.style.left = boardCoords.x + 'px';
    tileDiv.style.top = boardCoords.y + 'px';

    this.el = tileDiv;

    if (!isBGTile) {
      this.disableDrag = () => {
        this.dragAbortCallback?.();
        this.el.style.cursor = '';
        this.el.classList.remove('draggable');
      }
    }

  }

  setLetter(letter : Letter) {
    this.letter = letter;
    this.el.textContent = this.letter;

    const valueDiv = document.createElement('div');
    valueDiv.classList.add('tile-value');
    valueDiv.textContent = String(LETTER_VALUES[letter]);
    this.el.appendChild(valueDiv);

    this.value = LETTER_VALUES[letter] || 0;
  }

}
