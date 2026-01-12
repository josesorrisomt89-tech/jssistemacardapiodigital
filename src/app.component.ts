import { ChangeDetectionStrategy, Component, inject, OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { DataService } from './services/data.service';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet]
})
export class AppComponent implements OnInit {
  private dataService = inject(DataService);
  loadingStatus = this.dataService.loadingStatus;

  ngOnInit() {
    // A inicialização dos dados é movida para ngOnInit, que é um gancho de ciclo de vida mais seguro
    // para efeitos colaterais como chamadas de API. Isso garante que o componente
    // esteja totalmente construído antes de iniciar o carregamento de dados, evitando
    // possíveis condições de corrida durante a inicialização do aplicativo.
    this.dataService.load();
  }
}