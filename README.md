<p align="center"><img src="dist/assets/icon-192.png" width="88" alt="Ecoplant"></p>
<h1 align="center">Ecoplant</h1>
<p align="center"><strong>Cada folha, uma história.</strong><br>Um jardim organizado. Um olhar atento. Registros que acompanham o tempo.</p>
<p align="center"><a href="https://perabru.github.io/ecoplant/">Abrir aplicativo</a> · <a href="setup/README-GITHUB-PAGES.md">Publicação</a> · <a href="setup/README-FIREBASE.md">Configurar Firebase</a> · <a href="setup/Ecoplant_Regras_Para_Copiar.txt">Copiar regras do banco</a></p>

PWA em português para registrar plantas, fotografar folhas e acompanhar sua evolução. A interface usa verde floresta, ilustrações botânicas e temas claro e escuro. Funciona como site e pode ser instalado na tela inicial do Android e do iPhone.

## Recursos

- Cadastro e login com e-mail/senha ou conta Google, recuperação e perfil.
- Firebase Realtime Database com registros separados por UID e regras de validação.
- Cadastro, edição e exclusão de plantas, fotos reduzidas no navegador e histórico.
- Câmera ao vivo com alternância frontal/traseira e alternativa de câmera nativa/galeria.
- Integração real com um modelo de imagem publicado no Teachable Machine.
- Relatório animado com classes, probabilidades reais, observações, dados da planta e impressão em PDF.
- Triagem manual por sinais, claramente identificada quando não há modelo conectado.
- Modo local explícito com IndexedDB, exportação JSON e consulta offline do último conteúdo carregado.
- Manifest, ícones, Service Worker e instalação Android/iOS.
- Tema claro e escuro com preferência salva, botão de semente/planta e respeito à preferência inicial do aparelho.
- Splash com planta animada e loading de sete hexágonos durante as operações reais.

## Ativar o banco

Projeto Firebase: `wizardsofthesouth-8a2dc`.

Leia [setup/README-FIREBASE.md](setup/README-FIREBASE.md). As regras completas estão em [setup/database.rules.json](setup/database.rules.json), com uma cópia em texto em [setup/Ecoplant_Regras_Para_Copiar.txt](setup/Ecoplant_Regras_Para_Copiar.txt).

Os registros usam:

| Caminho | Conteúdo |
| --- | --- |
| `ecoplant/config` | Nome e versão da estrutura |
| `ecoplant/users/UID/profile` | Perfil, preferências e link do modelo |
| `ecoplant/users/UID/plants/ID` | Dados e foto de uma planta |
| `ecoplant/users/UID/analyses/ID` | Relatório e foto de uma avaliação |

As credenciais de acesso são gerenciadas pelo Firebase Authentication. Senhas não são gravadas no Realtime Database. O aplicativo não grava registros pessoais enquanto o caminho do usuário aceitar leitura anônima.

Em um banco usado por outros aplicativos, combine as regras preservando os outros caminhos. Permissões públicas em um pai não podem ser retiradas em um filho.

Autorize `perabru.github.io` em Authentication → Configurações → Domínios autorizados. O endereço é apenas o host, sem `https://` e sem `/ecoplant/`. Se continuar utilizando a publicação anterior, mantenha também `ecoplant-bruno.perabru.chatgpt.site`.

## Conectar o Teachable Machine

1. Treine um projeto de **imagem**, com pelo menos duas classes e diferentes folhas, fundos e iluminações.
2. Separe imagens novas para avaliar o modelo.
3. Exporte em **TensorFlow.js → Fazer upload**.
4. Em **Meu perfil → Teachable Machine**, cole `https://teachablemachine.withgoogle.com/models/ID/`.
5. Opcionalmente informe o nome exato da classe saudável. O aplicativo confere se ela existe no modelo.

Nenhum modelo padrão ou resultado fictício está incluído. A confiança expressa a escolha entre as classes treinadas e não mede a saúde ou a gravidade de uma condição. O processamento da imagem acontece no navegador, pelo modelo publicado. Pesos e bibliotecas precisam ser baixados com internet.

## Instalar

- Android: Chrome → Instalar aplicativo; alternativa pelo menu de três pontos.
- iPhone: Safari → Compartilhar → Adicionar à Tela de Início.

Câmera ao vivo e Service Worker exigem um contexto seguro HTTPS. A consulta offline depende de uma abertura prévia com conexão; alterações na conta só são confirmadas após resposta do Firebase. O modo local depende do armazenamento do navegador.

## Verificação

`node tests/check-firebase-rules.mjs` confere a sintaxe das expressões e os contratos das estruturas. Não substitui o simulador/emulador de regras nem confirma uma publicação no Firebase.

Os fluxos locais de cadastro, foto, triagem, relatório, perfil e reabertura foram verificados na interface, incluindo um viewport de 390 pixels. O login real, o isolamento em produção e o modelo de plantas dependem respectivamente dos provedores habilitados, da publicação das regras e do modelo do responsável.

## GitHub Pages

O código do aplicativo está em `dist/`. A pasta `docs/` é a cópia publicada pelo GitHub Pages, configurado em **main → /docs**.

Depois de editar o aplicativo, prepare os arquivos de publicação com:

```bash
npm run prepare:pages
```

Inclua as alterações de `dist/` e `docs/` no mesmo commit. Não é necessário instalar dependências para gerar a pasta: o script usa apenas Node.js. A publicação respeita o caminho `/ecoplant/`, incluindo os ícones, o manifest e o Service Worker.

Aplicativo estático, sem servidor próprio. Arquivos externos usados: Firebase JS SDK 13.2.0, TensorFlow.js 4.22.0, Teachable Machine Image 0.8.5 e fontes Google. A configuração web do Firebase é pública; as regras e a autenticação controlam os registros. Não incluir chaves de conta de serviço no código público.

## Estrutura do repositório

| Pasta | Uso |
| --- | --- |
| `dist/` | Código do aplicativo |
| `docs/` | Arquivos publicados no GitHub Pages |
| `setup/` | Regras e instruções de configuração |
| `scripts/` | Preparação da publicação |
| `tests/` | Verificações das regras |
| `notices/` | Créditos e licenças dos componentes |

## Componentes visuais

O Ecoplant adapta os componentes solicitados, preservando suas animações, os créditos e as licenças:

- [Switch de semente e planta — shadowfax29](https://uiverse.io/shadowfax29/sweet-warthog-93).
- [Loading de hexágonos — boryanakrasteva](https://uiverse.io/boryanakrasteva/ancient-quail-68).
- [CSS Animated plant — ldvick3m](https://codepen.io/ldvick3m/pen/omxPvY).

Os avisos completos acompanham o aplicativo em `THIRD_PARTY_NOTICES.txt`.
