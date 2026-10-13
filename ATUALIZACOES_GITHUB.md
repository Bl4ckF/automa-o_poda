# Book Poda — atualizações pelo GitHub Releases

## Primeira instalação do sistema de atualização

O pacote `Book_Poda_v12.3_GitHub_completo.zip` inclui o atualizador.
Se você já tem a versão 12.2, use a **correção v12.3** uma única vez, com o servidor fechado,
extraindo sobre a instalação existente. **Não apague** `Dados`, `Books`, `.venv` ou `Bases QField`.
Depois disso, as atualizações futuras podem ser instaladas pela página **Configurações**.

## Como conectar

1. Crie um repositório **público** no GitHub (por exemplo, `minha-empresa/book-poda`).
2. No Book Poda, vá a **Configurações → Atualização direta pelo GitHub**.
3. Informe `USUARIO/REPOSITORIO` ou `https://github.com/USUARIO/REPOSITORIO` e clique em **Salvar repositório**.
4. Use **Verificar atualizações**. Quando houver versão maior, clique em **Instalar atualização**.

Um repositório vazio ou sem **Release publicada** não fornece atualizações. Somente
repositórios públicos são suportados; não informe senhas nem tokens de acesso.
O sistema não cria o repositório nem publica a Release automaticamente por conta própria.

## Publicar uma nova versão

Para que o botão funcione, publique uma **Release** no repositório configurado:

- Atualize `version.json` para `12.4.0` (exemplo).
- Atualize o código do Book Poda no repositório (sem fotos, Books, `Dados`, `.venv` ou bases privadas).
- Inclua `tools/gerar_release.py` e `.github/workflows/publicar-release.yml` no repositório.
- Crie e envie a tag correspondente: `git tag v12.4.0` e `git push origin v12.4.0`.
- O GitHub Actions criará a Release com `book-poda-update.zip` e
  `book-poda-update.zip.sha256`.

Alternativa manual: execute `python tools/gerar_release.py`, crie uma Release com
**tag `v12.4.0`** e anexe os dois arquivos da pasta `dist/`.

**Não anexe simplesmente um ZIP genérico da instalação**: o arquivo de atualização exige
`version.json` e `update_manifest.json`, gerados pelo script de publicação.

## O que acontece ao instalar

1. O servidor consulta a versão mais recente publicada pela API oficial do GitHub.
2. Baixa `book-poda-update.zip` por HTTPS, confere SHA-256 e valida cada arquivo do manifesto.
3. Inicia um processo auxiliar e encerra o servidor localhost.
4. O auxiliar faz backup do código antigo em `Dados/atualizacoes/backups/` e substitui somente arquivos de programa permitidos.
5. Se uma substituição falhar, o auxiliar tenta restaurar o código antigo.
6. O servidor reinicia e a tela é recarregada. O último resultado da atualização fica registrado em `Dados/atualizacoes/status.json`.

`Dados`, `Books`, `Bases QField` e `.venv` são protegidos e **não são substituídos**.
O mapa continua carregando os dados locais já presentes. Para mudanças de estrutura das
bases QField, atualizações específicas de dados podem ser necessárias.

### Segurança

Uma atualização executa código publicado no repositório configurado. Use **somente um
repositório em que você confie**. O SHA-256 verifica integridade; não prova que o código
publicado seja seguro. O botão requer confirmação antes de instalar.

### Limitações

- Internet necessária para consultar o GitHub e baixar a Release.
- Não atualiza automaticamente sem confirmação.
- Repositórios privados ainda não são suportados.
- Se o processo de atualização falhar, abra `INICIAR_LOCALHOST.bat` novamente e consulte o status em Configurações.
