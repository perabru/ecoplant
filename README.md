<p align="center"><img src="dist/assets/ecoplant-icon-192.png" width="88" alt="Ecoplant"></p>
<h1 align="center">Ecoplant</h1>
<p align="center"><strong>Cada folha, uma história.</strong><br>Um jardim organizado. Um olhar atento. Registros que acompanham o tempo.</p>
<p align="center"><a href="https://perabru.github.io/ecoplant/">Abrir aplicativo</a> · <a href="setup/README-GITHUB-PAGES.md">Publicação</a> · <a href="setup/README-FIREBASE.md">Configurar Firebase</a> · <a href="setup/Ecoplant_Regras_Para_Copiar.txt">Copiar regras do banco</a></p>

PWA em português para registrar plantas, fotografar folhas e acompanhar sua evolução. A interface usa verde floresta, ilustrações botânicas e temas claro e escuro. Funciona como site e pode ser instalado na tela inicial do Android e do iPhone.

## Recursos

- Cadastro e login com e-mail/senha ou conta Google, recuperação e perfil.
- Firebase Realtime Database com registros separados por UID e regras de validação.
- Cadastro, edição e exclusão de plantas, fotos reduzidas no navegador e histórico.
- Câmera ao vivo com alternância frontal/traseira e alternativa de câmera nativa/galeria.
- Suporte a modelos de imagem do Teachable Machine por link hospedado, arquivos selecionados no navegador ou pasta `./my_model/` do aplicativo.
- Relatório animado com classes e probabilidades quando um modelo é carregado, observações, dados da planta e impressão em PDF.
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

Treine um projeto de **imagem**, com pelo menos duas classes, e reserve imagens novas para avaliação. Exporte em **TensorFlow.js** e escolha uma das opções:

- **Link hospedado:** use **Fazer upload** no Teachable Machine e cole o endereço `https://teachablemachine.withgoogle.com/models/ID/` em **Perfil → Teachable Machine**.
- **Arquivos do modelo:** use a exportação para download e, em **Perfil → Teachable Machine → Arquivos do modelo**, selecione juntos `model.json`, `metadata.json` e `weights.bin` — ou o nome do arquivo `.bin` declarado no manifesto de `model.json`. Esta opção aceita um único arquivo de pesos `.bin`. A seleção vale apenas para a sessão/aba e deve ser repetida após recarregar a página. Os arquivos selecionados não são enviados ao Firebase.
- **Modelo empacotado:** coloque os mesmos três arquivos em `dist/my_model/`. A fonte principal é `dist/`; execute `npm run prepare:pages` para copiá-los para `docs/my_model/`. No site, o modelo fica disponível pelo caminho relativo `./my_model/`.

Para modelos hospedados ou empacotados, opcionalmente informe o nome exato da classe saudável; o aplicativo confere se ela existe no modelo. Relatórios de arquivos importados preservam os nomes e as probabilidades das classes, sem reinterpretá-los pelas configurações de uma importação posterior. O HTML de exemplo fornecido pelo Teachable Machine **não contém os pesos treinados** e não substitui os arquivos exportados.

A pasta está preparada, mas **nenhum modelo real está incluído neste repositório**. Para concluir a conexão e avaliar o reconhecimento, é necessário fornecer o ZIP exportado em TensorFlow.js ou a URL pública do modelo. Enquanto isso, a identificação automática fica desabilitada e não tenta baixar arquivos ausentes. A triagem por sinais só é executada quando escolhida pelo usuário.

`npm run prepare:pages` gera `dist/model-config.js` e sua cópia publicada com a disponibilidade real do modelo. A preparação só habilita o modelo do EcoPlant quando todos os arquivos do manifesto estão presentes; um pacote parcial ou inválido interrompe a publicação.

Se um modelo configurado responder com uma falha temporária, o carregador repete as transferências de JSON e pesos até três vezes por arquivo, dentro do prazo total de 45 segundos. Para modelos hospedados no Teachable Machine, pode utilizar o destino oficial de armazenamento do mesmo modelo após uma falha de rede/servidor. Erros de permissão, arquivos inexistentes ou conteúdo inválido continuam sendo informados. A foto e as observações permanecem disponíveis para tentar novamente ou conectar os arquivos locais.

O processamento da imagem acontece no navegador. As bibliotecas e os modelos hospedados precisam ser baixados com internet. A confiança expressa a escolha entre as classes treinadas e não mede a saúde nem a gravidade de uma condição. O salvamento dos dados e relatórios mantém o fluxo atual do aplicativo: Firebase para a conta ou armazenamento do navegador no modo local.

## Instalar

- Android: Chrome → Instalar aplicativo; alternativa pelo menu de três pontos.
- iPhone: Safari → Compartilhar → Adicionar à Tela de Início.

Câmera ao vivo e Service Worker exigem um contexto seguro HTTPS. A consulta offline depende de uma abertura prévia com conexão; alterações na conta só são confirmadas após resposta do Firebase. O modo local depende do armazenamento do navegador.

## Verificação

`npm run check` verifica a sintaxe dos scripts, os contratos das regras Firebase, o carregamento/classificação/cancelamento com mocks explícitos e a estabilidade dos relatórios de modelos importados. Essas verificações não substituem o simulador/emulador de regras nem confirmam uma publicação no Firebase.

As verificações anteriores da interface cobriram os fluxos locais de cadastro, foto, triagem, relatório, perfil e reabertura, incluindo um viewport de 390 pixels. Isso não valida o reconhecimento com os novos métodos de carregamento: **não foram realizados testes reais de reconhecimento de plantas**, pois o modelo treinado ainda precisa ser fornecido. Login e isolamento em produção também dependem dos provedores habilitados, das regras publicadas e da validação no ambiente real.

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
| `dist/my_model/` | Destino dos arquivos exportados do modelo; pesos ainda não fornecidos |
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
