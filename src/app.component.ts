import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { DataService } from './services/data.service';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet]
})
export class AppComponent {
  constructor() {
    // Inicia o carregamento de dados de forma controlada após a inicialização do componente raiz.
    inject(DataService).load();
  }
}