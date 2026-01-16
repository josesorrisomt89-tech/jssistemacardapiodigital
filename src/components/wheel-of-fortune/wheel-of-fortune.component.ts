import { ChangeDetectionStrategy, Component, output, signal, computed, input } from '@angular/core';
import { WheelPrize } from '../../models';

@Component({
  selector: 'app-wheel-of-fortune',
  templateUrl: './wheel-of-fortune.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WheelOfFortuneComponent {
  colors = input<[string, string]>(['#7C3AED', '#000000']);
  prizes = input.required<WheelPrize[]>();
  prizeWon = output<WheelPrize>();
  
  isSpinning = signal(false);
  rotation = signal(0);
  spinDuration = signal(5000); // 5 seconds
  winningPrize = signal<WheelPrize | null>(null);
  
  conicGradient = computed(() => {
    const prizesList = this.prizes();
    if (!prizesList || prizesList.length === 0) return '';
    const color1 = this.colors()[0];
    const color2 = this.colors()[1];
    const segmentDegree = 360 / prizesList.length;
    let gradient = 'conic-gradient(';
    for (let i = 0; i < prizesList.length; i++) {
        const color = i % 2 === 0 ? color1 : color2;
        gradient += `${color} ${i * segmentDegree}deg ${(i + 1) * segmentDegree}deg`;
        if (i < prizesList.length - 1) {
            gradient += ', ';
        }
    }
    gradient += ')';
    return gradient;
  });
  
  spin() {
    if (this.isSpinning() || this.prizes().length === 0) return;

    this.winningPrize.set(null);
    this.isSpinning.set(true);
    const prizesList = this.prizes();
    const segmentCount = prizesList.length;
    const segmentDegree = 360 / segmentCount;
    const winningSegmentIndex = Math.floor(Math.random() * segmentCount);
    const prize = prizesList[winningSegmentIndex];
    
    // Calculate stop angle to point to the correct segment.
    // The pointer is at the top (0 deg). A positive rotation is clockwise.
    // To bring a segment at `targetAngle` to the top, we need to rotate by `360 - targetAngle`.
    const randomOffset = (Math.random() * 0.8 + 0.1) * segmentDegree; // Stop somewhere inside the segment, not on the line
    const targetAngle = winningSegmentIndex * segmentDegree + randomOffset;
    
    // The final rotation angle for the wheel. The number of spins is for animation effect.
    const fullSpins = 5;
    const stopAngle = 360 - targetAngle;
    const totalRotation = (fullSpins * 360) + stopAngle;

    this.rotation.set(totalRotation);

    setTimeout(() => {
      this.isSpinning.set(false);
      this.winningPrize.set(prize);
      this.prizeWon.emit(prize);
    }, this.spinDuration() + 200);
  }
}