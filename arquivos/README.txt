BOOK PODA V12 - LOCALHOST
========================

1. Extraia TODO o ZIP para uma pasta com permissao de escrita.
2. Abra INSTALAR_E_INICIAR.bat (primeiro uso no Windows).
3. Aguarde a instalacao e a abertura do navegador em http://localhost:8765/
4. Depois da primeira instalacao, use INICIAR_LOCALHOST.bat.
5. Mantenha o terminal aberto enquanto usa o sistema. Ctrl+C encerra.

Nao e necessario instalar JavaScript ou Node.js. O mapa executa no navegador.
O servidor escuta somente no seu computador (127.0.0.1).

MAPA QFIELD
- Arrastar, zoom, busca por coordenadas decimais, UTM e DMS.
- Busca por TD, RD ou numero operativo.
- Hover exibe identificacao/circuito/coordenadas.
- Pesquisa por coordenada cria marcador azul; Del remove o marcador.
- Camadas de Transformadores, Religadores e Postes (poste com zoom 15+).
- Areas consultadas QField permanecem em memoria enquanto a pagina do mapa estiver aberta.
- Os tiles QField sao arquivos locais, sem consultar os GeoPackages durante o movimento.
- Satelite/Mapa usam internet para imagem de fundo. 'Sem fundo' e offline.

BOOKS
- Ao gerar o PDF, salvos por padrao em Books/ANO/MM - Mes/
  Exemplo: Books/2026/10 - Outubro/BOOK-ENG-PDCG02-008398-2026.pdf
- Fotos preservadas em FOTOS-008398-2026 na pasta do PDF.
- A pasta raiz e configuravel em Configuracoes.
- Novo Book e iniciado automaticamente apos a geracao, sem excluir historico.
- Historico salvo em Dados/books.sqlite3. Rascunho em Dados/rascunho.json.
- Imagens coladas/enviadas inicialmente em Dados/uploads/.
- Books gerados anteriormente na versao desktop podem ser importados
  do arquivo BookPodaRegistros.json do perfil do usuario no primeiro uso.
- PDFs repetidos para mesma OS/ano nao sao sobrescritos automaticamente.

GOOGLE SHEETS
- Aba Respostas; coluna C OS, E Codigo, G Quantidade.
- Agrupa codigos 21307 e 21308. Preserva zeros da OS.
- Internet necessaria para atualizar; ultimo resultado fica em cache.

A interface foi desenvolvida para Windows (instalador BAT), e o servidor Python
pode rodar em outros sistemas usando `python server.py` apos instalar requirements.txt.

OBS: O mapa-base de satelite e fornecido por terceiros e depende da disponibilidade
externa. Os dados QField foram pre-processados das bases fornecidas.

CORRECAO V12.1 - MAPA
- O limite que mostrava apenas os primeiros 950 TDs foi removido.
- Em areas densas, circulos numerados representam grupos de equipamentos, sem excluir regioes.
- Clique num grupo ou aproxime o zoom para visualizar pontos individuais.
- Navegar nao remove dados QField de regioes consultadas; cache continua na sessao.
- Ao arrastar, os pontos movem com a camada por transformacao GPU e sao recalculados ao soltar.
- Scripts principais sao enviados sem cache do navegador para nao ficar com a versao antiga.
- Dados de satelite e mapa continuam dependentes de conexao com a internet.


V12.2 - Formatos de coordenadas
- Graus decimais com pontos cardeais (ex.: 20.554185°S 54.578959°W).
- Mantidos formatos UTM, decimais com sinal e graus/minutos/segundos.
- Pesquisa no mapa e validação de podas usam o mesmo parser.

V12.3 - SISTEMA DE ATUALIZACAO DIRETA PELO GITHUB
- Configuracoes > Atualizacao direta pelo GitHub.
- Configure o repositorio GitHub publico (USUARIO/REPOSITORIO).
- Verifica a Release mais recente, compara versoes e baixa atualizacao em ZIP.
- Confere SHA-256 do arquivo e checksums internos antes de instalar.
- Aplicacao com servidor fechado, backup do codigo e tentativa de rollback se falhar.
- Dados, Books, Bases QField e .venv preservados.
- Reinicio automatico e relatorio de status na interface.
- Publique novas releases com python tools/gerar_release.py e leia ATUALIZACOES_GITHUB.md.

NOVO EM 12.4.0 - LIMPEZA DE FAIXA
- Em Novo Book, selecione Tipo de servico: Limpeza de Faixa.
- Equipe fixa da modalidade: ENG LFCG02.
- Escolha uma unidade para o Book inteiro: m2 (m²) ou km.
- Informe a medicao total ou informe a medicao em cada trecho (somada automaticamente).
  Decimais aceitam ponto ou virgula; nao ha conversao automatica entre unidades.
- Registre coordenadas e fotos ANTES/DEPOIS por trecho. Cada trecho gera uma pagina.
- PDF: BOOK-ENG-LFCG02-[OS]-[ANO].pdf
- Fotos: FOTOS-LFCG02-[OS]-[ANO]. Books seguem a mesma pasta Ano/Mes.
- Prefixo OS para Limpeza de Faixa fica separado nas Configuracoes e, inicialmente,
  fica vazio por nao ter sido informado um prefixo oficial para este servico.
- Historico de Poda e Limpeza de Faixa funciona junto, sem excluir registros.
- A planilha Google Sheets 21307/21308 continua exclusiva da modalidade Poda.


BOOK PODA v12.5.0 - melhorias consolidadas
- OS: marcadores coloridos semitransparentes apenas sobre a celula da OS; legenda e personalizacao.
- Usar no Book: registra o marcador OK sem excluir outras OS.
- Limpeza de Faixa: ENG LFCG02 com prefixo ENG-LFBT02.CMAD e medicao em m2/km.
- Registros: Editar, substituir foto/OS/data/medicao, salvar PDF com copia antiga em HistoricoEdicoes.
- Materiais: catalogo da planilha lista_mateirias.xlsx; codigos/descricoes/unidades; tabela opcional no fim do PDF.
- Mapa QField: camadas, pesquisa de TD/RD/coordenada, hover, tela cheia, medir distancia e area aproximada.
- Imagens do satelite sao servidas por Esri; a resolucao depende da cobertura do provedor.
- GitHub Releases: tools/gerar_release.py inclui novos arquivos e github_controls.js.
- Dados, Books e Bases QField nao sao incluidos nas atualizacoes incrementais.
