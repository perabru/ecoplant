# Ativação do Firebase — Ecoplant

Projeto existente: `wizardsofthesouth-8a2dc`.

Este aplicativo usa **Firebase Authentication** e **Realtime Database**. Seus dados ficam exclusivamente em `ecoplant/users/UID`, separados por usuário. Não é necessário ativar Firestore ou Cloud Storage: as fotos são reduzidas no navegador e guardadas junto aos registros, até 240.000 caracteres por imagem.

## Arquivos prontos para copiar

- `Ecoplant_Regras_Para_Copiar.txt`: as mesmas regras de `database.rules.json`, em texto para copiar no editor de regras. Em um projeto compartilhado, integre somente o bloco `ecoplant`, conforme explicado abaixo.
- `Ecoplant_Estrutura.json`: estrutura inicial mínima, com `ecoplant/config/appName` e `schemaVersion`. Não contém usuários de exemplo, senhas, registros fictícios ou imagens.

Para criar essa estrutura no Console, em **Realtime Database → Dados**, adicione o filho `ecoplant` e, dentro dele, o filho `config`, com `appName: "Ecoplant"` e `schemaVersion: 1`. Se `ecoplant` já existir, acrescente apenas `config`, preservando `users` e os demais dados.

**Não importe a estrutura na raiz de um banco existente.** Se optar por importar JSON, selecione exclusivamente o nó `ecoplant` e importe somente o conteúdo interno desse nó, `{ "config": { "appName": "Ecoplant", "schemaVersion": 1 } }`. O arquivo fornecido inclui a chave externa `ecoplant` para documentar a posição correta; não importe essa chave novamente dentro de `ecoplant`. A operação de importação substitui o nó selecionado, portanto use a inclusão manual de `config` quando ele já contiver dados.

## 1. Ative as formas de acesso

No [Firebase Console](https://console.firebase.google.com/project/wizardsofthesouth-8a2dc/authentication/providers), abra **Authentication → Método de login**:

1. Ative **E-mail/senha**. Não é necessário ativar o link de acesso por e-mail.
2. Ative **Google**, escolha o e-mail de suporte do projeto e salve.
3. Em **Authentication → Configurações → Domínios autorizados**, acrescente:

   `ecoplant-bruno.perabru.chatgpt.site`

Use somente o nome do domínio, sem `https://` nem caminho. Se o aplicativo for publicado em outro domínio, acrescente esse domínio também. Não remova os domínios que outros aplicativos do projeto já utilizam.

O botão **Continuar com Google** usa uma janela de autenticação aberta por ação direta do usuário. Caso o navegador bloqueie a janela, permita pop-ups para o aplicativo e tente novamente. O aplicativo solicita somente autenticação da conta Google; não lê sua caixa de entrada do Gmail.

## 2. Integre as regras sem alterar outros aplicativos

**Não substitua as regras atuais do projeto pelo arquivo de exemplo.** Este é um Firebase já existente e pode atender a outros aplicativos.

Em **Realtime Database → Regras**, copie as regras atuais para um backup. Abra `database.rules.json` desta pasta e acrescente apenas o objeto `ecoplant` dentro do objeto `rules` que já existe. Preserve todas as regras e todos os caminhos não relacionados ao novo aplicativo.

O arquivo completo contém `.read: false` e `.write: false` no nível superior apenas para documentar uma configuração independente segura. Esses dois campos não devem substituir uma configuração compartilhada sem revisão. O `firebase.json` desta pasta é um exemplo restrito a regras de Realtime Database; **não execute um deploy global de regras sobre o projeto existente**. Prefira integrar e publicar o bloco pelo Console.

### Atenção às permissões herdadas

No Realtime Database, uma permissão concedida por uma regra superior não pode ser retirada por uma regra abaixo dela. Se o projeto tiver `.read: true` ou `.write: true` no nível superior ou em algum pai de `ecoplant`, a proteção `auth.uid == UID` não conseguirá impedir esse acesso herdado. Nesse caso, distribua as permissões para os caminhos específicos já utilizados, preservando o funcionamento dos outros aplicativos, antes de guardar dados pessoais aqui.

Use o simulador de regras para verificar:

| Operação | Resultado esperado |
| --- | --- |
| Usuário A lê/escreve `ecoplant/users/A` | Permitido |
| Usuário A lê/escreve `ecoplant/users/B` | Negado |
| Sem login lê/escreve qualquer perfil | Negado |
| Foto com mais de 240.000 caracteres | Negado |
| Registro de planta sem nome ou com ID diferente da chave | Negado |

## 3. Confira o primeiro acesso real

1. Abra o endereço publicado e crie uma conta de teste.
2. Cadastre uma planta, saia da conta e entre novamente.
3. Confira o registro em **Realtime Database → Dados → ecoplant → users**.
4. Entre com Google e confirme que o cadastro fica associado a essa conta.
5. Use **Esqueci minha senha** em uma conta de e-mail/senha. A interface não revela se um endereço está cadastrado; a entrega depende do Firebase e pode chegar ao spam.

O cadastro e os acessos por e-mail/senha ou Google chamam `ensureProfile(user)` para criar o perfil no banco. A rotina preenche somente os campos ausentes `name`, `displayName`, `email`, `createdAt` e `updatedAt`; preserva dados já editados e usa uma atualização condicional para não sobrescrever outra edição simultânea. Ela também pode ser chamada novamente ao restaurar uma sessão ou depois de corrigir as regras.

Se a autenticação concluir e a gravação do perfil falhar, a conta criada é preservada. O erro `database/profile-pending`, com `authSucceeded: true`, sinaliza que falta concluir o perfil; não é necessário criar outra conta. O aplicativo bloqueia gravações se uma consulta anônima ao caminho do usuário ainda receber autorização de leitura. Corrija as regras antes de tentar novamente.

As regras exigem `displayName`, `email` e `createdAt` no perfil. Os resultados salvos aceitam somente os métodos `guided` e `teachable-machine`, com campos limitados e escores entre zero e um. A verificação local em `tests/check-firebase-rules.mjs` cobre as duas estruturas e não publica regras na nuvem.

A configuração web e a API key fornecidas são identificadores públicos do aplicativo, não uma credencial de administrador. A proteção dos registros depende das regras e da autenticação. Não adicione chave de conta de serviço ou segredo OAuth ao JavaScript público.

## 4. Configure seu modelo do Teachable Machine

1. No [Teachable Machine](https://teachablemachine.withgoogle.com/), treine um **projeto de imagem** com as classes de plantas e condições que pretende reconhecer. Inclua imagens variadas e uma classe saudável quando essa distinção fizer parte do projeto.
2. Em **Exportar modelo → Tensorflow.js**, publique o modelo e copie a URL no formato `https://teachablemachine.withgoogle.com/models/SEU_ID/`.
3. No **Perfil** do Ecoplant, informe essa URL e, se desejar, o nome exato da classe saudável. Salve as alterações.
4. Faça uma análise com uma foto e verifique se o resultado mostra as classes reais do seu modelo. A qualidade depende das imagens e das classes usadas no treinamento; os escores do modelo não equivalem a confirmação de doença.

A configuração é privada por usuário, nos campos `profile/modelURL` e `profile/healthyClass`. As regras aceitam URLs publicadas no domínio oficial do Teachable Machine, até 300 caracteres, e o nome da classe saudável até 200 caracteres. O modelo é carregado no navegador; o aplicativo não inventa resultados quando não houver modelo configurado ou não for possível carregá-lo.

## 5. Instale no celular

- **Android:** abra o endereço no Chrome e use **Instalar aplicativo**. Se o botão automático não aparecer, abra o menu de três pontos e procure **Instalar aplicativo** ou **Adicionar à tela inicial**.
- **iPhone/iPad:** abra o endereço no Safari, toque em **Compartilhar → Adicionar à Tela de Início → Adicionar**. Mantenha **Abrir como App da Web** ativado, quando essa opção existir.

A instalação depende de HTTPS e do suporte do navegador. As contas e os dados do Firebase exigem internet para sincronizar; o aplicativo guarda o shell e o último conteúdo consultado no dispositivo para acesso offline. Uma alteração só é apresentada como sincronizada após confirmação do Firebase.

## Arquivos PWA

- `dist/manifest.webmanifest`: nome, ícones, escopo e apresentação independente.
- `dist/sw.js`: cache do shell e de bibliotecas públicas; não armazena respostas da autenticação, do Realtime Database ou do Google OAuth.
- `dist/pwa.js`: instalação, instruções específicas e aviso de nova versão.
- `dist/assets/`: ícones PNG e favicon SVG.

Ao publicar alterações, incremente `VERSION` em `sw.js` para renovar o cache do aplicativo. O Service Worker só remove caches com o prefixo `ecoplant-`.
