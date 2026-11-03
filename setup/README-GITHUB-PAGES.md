# Publicação do Ecoplant no GitHub Pages

Repositório previsto: `perabru/ecoplant`. Endereço previsto após a publicação: `https://perabru.github.io/ecoplant/`.

O código principal fica em `dist/`. A pasta `docs/` é uma cópia gerada para a publicação; faça alterações em `dist/` e gere a cópia novamente. O aplicativo usa Firebase diretamente pelo navegador e não depende de um servidor no GitHub Pages.

## Preparar os arquivos

Na raiz do projeto, execute uma vez após concluir as alterações:

```bash
node scripts/prepare-pages.mjs
```

Esse comando copia os arquivos públicos de `dist/` para `docs/`, inclui `.nojekyll` e disponibiliza as regras em `docs/assets/database.rules.json`. O arquivo de regras contém somente a configuração de acesso do banco; publicá-lo não aplica as regras no Firebase.

O gerador não copia `.openai`, `.git`, arquivos ocultos, dependências, mapas de código nem arquivos com nomes de credenciais ou chaves privadas. A configuração web pública do Firebase continua em `firebase.js`, como exige o SDK; ela não concede acesso de administrador.

`docs/.generated-by-ecoplant` identifica os arquivos que o comando gerencia. Na próxima execução, somente esses arquivos podem ser substituídos ou removidos. Se `docs/` já contiver conteúdo sem esse marcador, o comando para sem apagá-lo. Não edite os arquivos gerados diretamente nem inclua registros reais de usuários nessa pasta.

## Configurar o GitHub Pages

Depois de enviar o código e a pasta `docs/` para a branch `main` do repositório:

1. Abra **Settings → Pages** em `perabru/ecoplant`.
2. Em **Build and deployment → Source**, selecione **Deploy from a branch**.
3. Selecione a branch **main** e a pasta **/docs**.
4. Salve e acompanhe a execução de publicação em **Actions**.
5. Confirme o endereço informado pelo GitHub. O endereço previsto não é prova de uma publicação concluída.

A pasta `docs/` deve estar incluída no commit. O arquivo `.nojekyll` mantém a publicação dos arquivos estáticos sem processamento do Jekyll. Não selecione `/ (root)`, pois o `index.html` publicado fica em `docs/`.

## Autorizar o endereço no Firebase

Em **Firebase Authentication → Configurações → Domínios autorizados**, adicione:

```text
perabru.github.io
```

Use o domínio, sem `https://` e sem `/ecoplant/`. Preserve os demais domínios já utilizados no projeto. A autorização de um endereço `*.chatgpt.site` não autoriza automaticamente o domínio do GitHub Pages.

Mantenha o `authDomain` do aplicativo como `wizardsofthesouth-8a2dc.firebaseapp.com`. O GitHub Pages não fornece os endpoints reservados `/__/auth/` do Firebase Hosting; não troque esse campo para `perabru.github.io` sem implementar outra solução de hospedagem dos auxiliares de autenticação.

O acesso Google usa `signInWithPopup`, iniciado pelo botão de login. Pop-ups podem ser bloqueados pelo navegador ou pela plataforma: permita a janela para esse endereço e tente novamente. O fluxo não muda automaticamente para `signInWithRedirect`, porque esse método exige cuidados adicionais com armazenamento de terceiros. Teste o acesso Google no navegador comum e no aplicativo instalado em cada sistema; a instalação de um PWA não remove restrições do navegador.

As regras de `setup/database.rules.json` continuam necessárias. Cada usuário deve acessar apenas `ecoplant/users/SEU_UID`. O aplicativo verifica se o caminho do usuário admite leitura anônima antes de gravar seus dados.

## Caminhos e instalação

| Recurso | Configuração compatível com `/ecoplant/` |
| --- | --- |
| Entrada do aplicativo | `docs/index.html` |
| CSS e módulos JavaScript | Caminhos relativos `./arquivo` |
| Manifest | `./manifest.webmanifest` |
| Identidade, início e escopo do manifest | `./` |
| Ícones | `./assets/...` |
| Service Worker | `./sw.js`, registrado a partir de `import.meta.url` |
| Escopo do Service Worker | Diretório do aplicativo, sem interceptar outros repositórios |
| Navegação interna | Rotas com `#`, sem depender de reescrita do servidor |

Abra o endereço HTTPS com a barra final: `https://perabru.github.io/ecoplant/`. No Android, use a opção de instalar no Chrome. No iPhone/iPad, abra no Safari e use **Compartilhar → Adicionar à Tela de Início**. O nome da opção pode variar com o sistema.

Depois de uma atualização, incremente a versão do cache no `dist/sw.js` quando houver alterações no shell, execute o gerador e publique os arquivos atualizados. Não altere `docs/sw.js` manualmente.

## Conferência depois da publicação

1. Abra a página de login e confira CSS, ícones e ilustrações.
2. Cadastre ou acesse uma conta e confirme o perfil em `ecoplant/users/UID/profile` no Firebase.
3. Cadastre uma planta, recarregue e confira se o registro permanece.
4. Teste login Google e recuperação de senha com contas próprias.
5. Instale em Android/iOS e confira a abertura pelo ícone.
6. Após uma primeira visita online, teste a abertura sem conexão. Gravações na nuvem continuam exigindo internet.

As regras para download ficarão em `https://perabru.github.io/ecoplant/assets/database.rules.json`, depois que a publicação tiver sido concluída.

## Documentação oficial

- [Configurar a origem de publicação do GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).
- [Criar um site do GitHub Pages e usar .nojekyll](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site).
- [Autenticação Google no Firebase](https://firebase.google.com/docs/auth/web/google-signin).
- [Cuidados com login por redirecionamento](https://firebase.google.com/docs/auth/web/redirect-best-practices).
