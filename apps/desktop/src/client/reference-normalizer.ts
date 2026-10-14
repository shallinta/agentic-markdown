/** Default casing equivalence is audited against Unicode 16–18 (FinalSigma
 * disappears on uppercasing). Recheck this boundary when upgrading runtimes. */
export class ReferenceNormalizer {
  value = "";
  overflow = false;
  private high = "";
  private space = false;
  constructor(private maximum: number) {}
  private emit(point: string): number {
    if (/^[\t\n\r ]$/.test(point)) {
      this.space = this.value.length > 0;
      return 0;
    }
    const output = (this.space ? " " : "") + point.toLowerCase().toUpperCase();
    this.space = false;
    if (this.value.length + output.length > this.maximum) this.overflow = true;
    else this.value += output;
    return output.length;
  }
  push(unit: string): number {
    let cost = 0;
    if (this.high) {
      const high = this.high;
      this.high = "";
      if (/^[\udc00-\udfff]$/.test(unit)) return this.emit(high + unit);
      cost += this.emit(high);
    }
    if (/^[\ud800-\udbff]$/.test(unit)) this.high = unit;
    else cost += this.emit(unit);
    return cost;
  }
  finish(): number {
    const high = this.high;
    this.high = "";
    return high ? this.emit(high) : 0;
  }
}
