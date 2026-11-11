import type { CellStatus } from './interfaces/model-row.interface.js';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const GREY = '\x1b[90m';
const LIGHT_WHITE = '\x1b[37m';
const BRIGHT_WHITE = '\x1b[1;97m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';
const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';

const SHORT_LABELS: Record<string, string> = {
  ALTERNATIVES: 'ALTS',
  PICK: 'PICK',
  'TRELLIS-IN': 'TRELLIS',
  '3D-GLB': '3D-GLB',
  SIMPLIFY: 'SIMPLIFY',
  ATLAS: 'ATLAS',
  TEXTURIZE: 'TEXTURE',
  PLINTH: 'PLINTH',
  PREVIEWS: 'PREVIEWS',
  UNFOLD: 'UNFOLD',
  SHEETS: 'SHEETS',
  ASSEMBLY: 'ASSEMBLY',
};

const COMPACT_LABELS: Record<string, string> = {
  ALTERNATIVES: 'ALT',
  PICK: 'PICK',
  'TRELLIS-IN': 'TR-IN',
  '3D-GLB': '3D',
  SIMPLIFY: 'SIMP',
  ATLAS: 'ATLAS',
  TEXTURIZE: 'TEX',
  PLINTH: 'PLINTH',
  PREVIEWS: 'PREV',
  UNFOLD: 'UNF',
  SHEETS: 'SHTS',
  ASSEMBLY: 'ASSY',
};

export interface StepSlot {
  readonly label: string;
  status: 'PENDING' | 'RUNNING' | CellStatus;
  seconds?: number;
}

export interface StepSlotInit {
  readonly label: string;
  readonly status?: 'PENDING' | 'RUNNING' | CellStatus;
  readonly seconds?: number;
}

export class ModelRow {
  private readonly slots: StepSlot[] = [];
  private subMessage = '';
  private hasSubLine = false;
  private isEnded = false;

  constructor(
    private readonly label: string,
    stepLabels: readonly (string | StepSlotInit)[] = [],
    private readonly interactive: boolean = process.stdout.isTTY === true,
  ) {
    this.slots = stepLabels.map((item) => {
      if (typeof item === 'string') {
        return { label: item, status: 'PENDING' };
      }
      return {
        label: item.label,
        status: item.status ?? 'PENDING',
        seconds: item.seconds,
      };
    });
    if (this.interactive) {
      process.on('exit', () => process.stdout.write(SHOW_CURSOR));
      process.on('SIGINT', () => {
        process.stdout.write(SHOW_CURSOR);
        process.exit(130);
      });
    }
  }

  public begin(): void {
    if (this.interactive) {
      process.stdout.write(HIDE_CURSOR);
    }
    this.render();
  }

  public running(stepLabel: string, subMessage?: string): void {
    const slot = this.slots.find((s) => s.label === stepLabel);
    if (slot) {
      slot.status = 'RUNNING';
    } else {
      this.slots.push({ label: stepLabel, status: 'RUNNING' });
    }
    if (subMessage !== undefined) {
      this.subMessage = subMessage;
    }
    this.render();
  }

  public subStatus(message: string): void {
    this.subMessage = message.trim();
    if (this.interactive && !this.isEnded) {
      this.render();
    }
  }

  public clearSub(): void {
    if (this.interactive && this.hasSubLine) {
      process.stdout.write('\r\x1b[2K\x1b[1A\r\x1b[2K');
      this.hasSubLine = false;
      const termWidth = process.stdout.columns || 120;
      process.stdout.write(this.truncateAnsi(this.graphLine(termWidth), termWidth - 1));
    }
  }

  public finish(stepLabel: string, status: CellStatus, seconds: number): void {
    const slot = this.slots.find((s) => s.label === stepLabel);
    if (slot) {
      slot.status = status;
      slot.seconds = seconds;
    } else {
      this.slots.push({ label: stepLabel, status, seconds });
    }
    this.subMessage = '';
    this.render();
  }

  public end(totalSeconds: number, passed: boolean, failure: readonly string[]): void {
    this.isEnded = true;
    const verdict = passed ? `${GREEN}OK${RESET}` : `${RED}FAIL${RESET}`;
    const termWidth = process.stdout.columns || 120;
    const graph = this.graphLine(termWidth);
    const line = `${graph} │ ${totalSeconds.toFixed(1)}s ${verdict}`;

    if (this.interactive) {
      if (this.hasSubLine) {
        process.stdout.write('\r\x1b[2K\x1b[1A\r\x1b[2K');
      } else {
        process.stdout.write('\r\x1b[2K');
      }
      process.stdout.write(`${this.truncateAnsi(line, termWidth - 1)}\n${SHOW_CURSOR}`);
    } else {
      process.stdout.write(`${line}\n`);
    }
    this.hasSubLine = false;
    failure.forEach((message) => process.stdout.write(`    ${message}\n`));
  }

  private prefix(): string {
    return `${this.label.padEnd(22, ' ')} `;
  }

  private resolveLabel(raw: string, termWidth: number): string {
    if (termWidth < 130) {
      return COMPACT_LABELS[raw] ?? raw;
    }
    if (termWidth < 165) {
      return SHORT_LABELS[raw] ?? raw;
    }
    return raw;
  }

  private graphLine(termWidth: number): string {
    return `${this.prefix()}${this.renderCells(termWidth)}`;
  }

  private renderCells(termWidth: number): string {
    const runningIndex = this.slots.findIndex((s) => s.status === 'RUNNING');

    return this.slots
      .map((slot, i) => {
        const displayLabel = this.resolveLabel(slot.label, termWidth);

        if (slot.status === 'DONE') {
          const durationStr = termWidth < 115 ? '' : ` ${(slot.seconds ?? 0).toFixed(1)}s`;
          return `${GREEN}✔ ${displayLabel}${durationStr}${RESET}`;
        }
        if (slot.status === 'FAIL') {
          return `${RED}✖ ${displayLabel} ${(slot.seconds ?? 0).toFixed(1)}s${RESET}`;
        }
        if (slot.status === 'SKIP') {
          return `${YELLOW}⏭ ${displayLabel}${RESET}`;
        }
        if (slot.status === 'RUNNING') {
          return `${BRIGHT_WHITE}⟳ ${displayLabel}${RESET}`;
        }
        // PENDING: check if it is the immediately upcoming step ("à medida que fica proximo torna mais branco")
        if (runningIndex !== -1 && i === runningIndex + 1) {
          return `${LIGHT_WHITE}${displayLabel}${RESET}`;
        }
        // Future pending steps in grey
        return `${GREY}${displayLabel}${RESET}`;
      })
      .join(' │ ');
  }

  private buildSubLine(termWidth: number): string | null {
    if (!this.subMessage) return null;
    const cleanSub = this.subMessage.replace(/[\r\n\t]+/g, ' ').trim();
    if (!cleanSub) return null;

    const maxMsgLen = Math.max(20, termWidth - 8);
    const truncated = cleanSub.length > maxMsgLen ? `${cleanSub.slice(0, maxMsgLen - 3)}...` : cleanSub;
    return `   ${CYAN}↳${RESET} ${GREY}${truncated}${RESET}`;
  }

  private truncateAnsi(str: string, maxVisible: number): string {
    let visible = 0;
    let result = '';
    let inEscape = false;
    let escapeSeq = '';

    for (let i = 0; i < str.length; i++) {
      const char = str[i];
      if (char === '\x1b') {
        inEscape = true;
        escapeSeq = char;
        continue;
      }
      if (inEscape) {
        escapeSeq += char;
        if ((char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z')) {
          inEscape = false;
          result += escapeSeq;
        }
        continue;
      }

      if (visible >= maxVisible) {
        break;
      }
      result += char;
      visible++;
    }

    if (visible >= maxVisible) {
      result += RESET;
    }
    return result;
  }

  private render(): void {
    if (!this.interactive || this.isEnded) return;

    const termWidth = process.stdout.columns || 120;
    const graph = this.truncateAnsi(this.graphLine(termWidth), termWidth - 1);
    const sub = this.buildSubLine(termWidth);

    if (this.hasSubLine) {
      process.stdout.write('\r\x1b[2K\x1b[1A\r\x1b[2K');
    } else {
      process.stdout.write('\r\x1b[2K');
    }

    if (sub !== null) {
      process.stdout.write(`${graph}\n${sub}`);
      this.hasSubLine = true;
    } else {
      process.stdout.write(graph);
      this.hasSubLine = false;
    }
  }
}
