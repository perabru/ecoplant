# Modelo EcoPlant — 10 classes

Este é o modelo incorporado na versão 1.2.0 do [EcoPlant](https://perabru.github.io/ecoplant/#scan). Seus arquivos de inferência estão em `dist/my_model/` e são publicados em `docs/my_model/`. Desde a versão 1.3.0, está disponível em **Treinamento do projeto — 10 classes**, e deixou de ser a opção inicial após erros observados em fotografias externas. A análise completa usa o modelo DINOv2/PlantVillage para as culturas que ele reconhece. Veja a [validação da versão 1.3.0](RELEASE_1_3_0.md). Nenhum desses modos requer importar arquivos nem informar uma chave de API.

## Origem e treinamento

O projeto fornecido, `project (2).tm`, continha 5.155 imagens JPEG de 224 × 224 e o manifesto do Teachable Machine 2.4.19, sem pesos treinados. Portanto, esta versão contém um novo treinamento feito com essas imagens, depois da preparação descrita abaixo.

Usou-se a biblioteca oficial `@teachablemachine/image` 0.8.5 com TensorFlow.js 4.22.0. O backbone MobileNet V2, alpha 0,35, corresponde ao carregado pela interface oficial ao abrir este projeto. A cabeça tem uma camada Dense de 100 unidades ReLU seguida de dez saídas softmax, conforme a implementação e o exemplo oficiais; esse tamanho da cabeça não constava no manifesto enviado.

Foram preservados os parâmetros do projeto: **50 épocas**, **lote 16** e **taxa de aprendizagem 0,001**. A extração de características do MobileNet foi feita em WASM; a cabeça foi treinada no backend CPU da mesma biblioteca TensorFlow.js. O pré-processamento usa RGB 224 × 224, sem espelhamento, normalizado por `pixels / 127 - 1`, conforme a biblioteca Teachable Machine.

A interface de treinamento não concluiu neste navegador sem WebGL; o treino foi concluído usando a biblioteca oficial em Node. Nenhum resultado de classificação foi simulado. A inferência publicada permanece compatível com `tmImage.CustomMobileNet` no navegador.

Fontes: [biblioteca oficial de imagem](https://github.com/googlecreativelab/teachablemachine-community/blob/master/libraries/image/README.md), [implementação do treinamento](https://github.com/googlecreativelab/teachablemachine-community/blob/master/libraries/image/src/teachable-mobilenet.ts) e [pré-processamento](https://github.com/googlecreativelab/teachablemachine-community/blob/master/libraries/image/src/utils/tf.ts).

## Preparação dos dados

Foram retiradas 322 cópias exatas repetidas dentro da mesma classe e todas as 18 entradas de nove grupos de imagens iguais com rótulos contraditórios entre Ferrugem e Míldio. Não se escolheu arbitrariamente um dos rótulos conflitantes.

Das **4.815 imagens únicas utilizáveis**, **4.088** formaram o conjunto de treinamento e **727** foram separadas antes do treino para avaliação. A biblioteca usa 617 imagens adicionais do conjunto de 4.088 para sua validação interna; 3.471 imagens participaram da otimização da cabeça. As 727 imagens externas a esse processo não foram utilizadas para ajustar pesos, escolher a época ou mudar o limiar.

| Classe original | Arquivos originais | Únicas utilizáveis | Processo de treino | Avaliação reservada |
| --- | ---: | ---: | ---: | ---: |
| Antracnose | 684 | 623 | 529 | 94 |
| Desconhecidas | 457 | 457 | 388 | 69 |
| Ferrugem | 546 | 525 | 446 | 79 |
| Fumagina | 500 | 500 | 425 | 75 |
| Míldio | 492 | 474 | 402 | 72 |
| Oídio | 878 | 871 | 740 | 131 |
| Plantas_Saudaveis | 601 | 596 | 506 | 90 |
| Podridão_radicular | 379 | 157 | 133 | 24 |
| Vitiligo | 220 | 215 | 182 | 33 |
| Planta de plastico | 398 | 397 | 337 | 60 |

A separação externa usa a semente 20261112. Em cada classe, os hashes únicos foram ordenados por `SHA256(seed + NUL + classe + NUL + hash_da_imagem)`; os primeiros `ceil(15% × quantidade_da_classe)` formam a reserva. A interseção SHA256 entre os dois conjuntos é zero. Imagens quase idênticas, recortes e fotografias da mesma origem não foram investigados.

As imagens, o projeto `.tm` e os nomes dos arquivos de fotografias não são publicados no repositório nem no site.

## Avaliação com os pesos exportados

O modelo final foi carregado novamente de `model.json` e dos pesos `.bin`, executando inferência nas **727 imagens reservadas**. Usou-se TensorFlow.js 4.22.0 com backend WASM e as probabilidades softmax originais, sem reajuste dos escores.

- Correspondências da classe principal com o rótulo fornecido: **661/727 (90,92%)**.
- F1 médio entre as dez classes: **88,31%**.
- Saída com confiança igual ou superior a 0,75: **690/727 (94,91%)**.
- Dentro desse grupo, **642** correspondências e **48** divergências; acerto interno de **93,04%**.
- **37** imagens ficaram abaixo do limiar e devem manter o resultado inconclusivo no aplicativo.

| Classe de referência | Imagens | Acertos | Recall | Precisão | F1 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Antracnose | 94 | 83 | 88,30% | 92,22% | 90,22% |
| Desconhecidas | 69 | 69 | 100,00% | 95,83% | 97,87% |
| Ferrugem | 79 | 69 | 87,34% | 89,61% | 88,46% |
| Fumagina | 75 | 75 | 100,00% | 100,00% | 100,00% |
| Míldio | 72 | 67 | 93,06% | 84,81% | 88,74% |
| Oídio | 131 | 120 | 91,60% | 93,75% | 92,66% |
| Plantas_Saudaveis | 90 | 78 | 86,67% | 96,30% | 91,23% |
| Podridão_radicular | 24 | 18 | 75,00% | 64,29% | 69,23% |
| Vitiligo | 33 | 22 | 66,67% | 75,86% | 70,97% |
| Planta de plastico | 60 | 60 | 100,00% | 88,24% | 93,75% |

Esses números medem a classificação interna dos rótulos fornecidos. Não são uma avaliação independente em campo nem validação agronômica dos rótulos. A decodificação JPEG do avaliador local pode diferir ligeiramente do canvas de um navegador. A confiança é uma escolha entre as dez classes; não mede saúde, gravidade ou certeza de diagnóstico.

O limiar de 0,75 é a política já existente no aplicativo. Ele não foi reduzido com base nesses resultados e não é um nível de confiança agronômico calibrado.

## Interpretação no aplicativo

- `Plantas_Saudaveis` corresponde à classe saudável deste treinamento.
- `Desconhecidas` e `Planta de plastico` geram uma classificação neutra, com rótulo e pontuação quando a confiança é suficiente, sem afirmar doença ou saúde.
- As demais classes preservam o rótulo literal do projeto, inclusive `Vitiligo`; o aplicativo não transforma esses nomes em diagnóstico confirmado.
- Escores abaixo de 0,75 continuam inconclusivos e permitem ajustar o enquadramento ou fotografar novamente.

A política está em `ecoplant-config.json` e é validada contra `metadata.labels` na preparação da publicação. Preferências de um modelo pessoal no Perfil não alteram a interpretação do EcoPlant. Uma reanálise mantém a origem publicada; relatórios de arquivos locais exigem reconectar os arquivos originais para evitar usar outro modelo importado na aba.

O modelo é executado no navegador. Abra o aplicativo com internet para carregar seus arquivos e bibliotecas. Esta versão não promete recarregar os pesos do EcoPlant sem conexão; o armazenamento offline dos registros e o cache da IA geral são mecanismos separados.

## Integridade dos artefatos

| Arquivo | Bytes | SHA256 |
| --- | ---: | --- |
| `model.json` | 91,912 | `d72cfe99207c60a77c00d089471e437e733f55259c3d08945562374e1476228b` |
| `metadata.json` | 471 | `fcba0f9f87e484331d45af3e3965d0ab8262a54c8d8c1cf76888aaf04e101d0a` |
| `weights.bin` | 2,157,232 | `c3afde7be05451e2388c1ed73874ba4f96ecbd2a2d060d01734f66c4354a9b20` |

O nome exibido em `metadata.json` foi definido como `Modelo EcoPlant — 10 classes`; os rótulos e sua ordem correspondem às saídas dos pesos. A publicação inclui somente topologia, metadados, configuração validada e shards declarados, sem fotografias.

Os parâmetros, contagens, hashes, métricas por classe e matriz de confusão estão em [ecoplant-evaluation.json](ecoplant-evaluation.json).
