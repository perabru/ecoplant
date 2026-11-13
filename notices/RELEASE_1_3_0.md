# EcoPlant 1.3.0 — identificação e saúde

Data: 13 de novembro de 2026.

## Falhas reproduzidas

O modo inicial da versão 1.2.0 usava um modelo de dez classes de condições da planta, sem classes de espécie. O relatório mostrava a espécie apenas quando cadastrada manualmente. Além disso, a função compartilhada dos indicadores de saúde não interpretava os resultados desse modelo.

Foi executada inferência real com os pesos publicados e as bibliotecas exatas. A fotografia de referência `Tomato___healthy/000146ff-92a4-4db6-90ad-8fce2ae4fddd___GH_HL Leaf 259.1.JPG` foi rotulada como Oídio pelo modelo de dez classes, com pontuação de 99,953% no ambiente local. O mesmo erro foi reproduzido no aplicativo publicado, usando sua interface de envio de imagem. Uma fotografia de sarna da macieira também recebeu Fumagina. Portanto, o problema envolvia o alcance e as respostas do modelo selecionado, além da apresentação.

## Correção

A análise completa DINOv2/PlantVillage passa a ser o padrão. A cultura é derivada da soma das 38 probabilidades originais por grupo, antes da redução das três classes guardadas no relatório. A identificação exige pontuação de pelo menos 0,75, margem de 0,15 e aprovação da verificação de compatibilidade da imagem. A saúde mantém a política existente. Se a doença não for conclusiva, a cultura pode continuar identificada.

A espécie provável e a referência botânica são guardadas em `result.possibilities`, com os campos `name` e `reason` já aceitos pelo Firebase. Não se adicionaram campos incompatíveis nem se aumentou o número de previsões persistidas. Categorias amplas conservam referências como `Citrus spp.` e `Cucurbita spp.`. Os pesos e limiares do modelo não foram alterados.

O modelo de dez classes permanece como comparação explícita do projeto. Sua identificação de espécie é independente e não sobrescreve sua classificação. Uma falha nessa etapa opcional não descarta a classificação concluída. A análise completa não usa esse treinamento como substituto silencioso em caso de falha.

## Verificação de inferência real

Arquivos do modelo geral e centroides foram conferidos contra os hashes SHA-256 fixados no código. Foi usado ONNX Runtime Web 1.30.0, backend WASM, com o pré-processamento da aplicação e imagens JPEG reais. Esses resultados não são mocks:

| Entrada | Classe do modelo geral | Resultado de identificação |
| --- | --- | --- |
| Folha saudável de tomateiro | `Tomato___healthy`, 0,987735914 | Tomateiro; grupo com aproximadamente 99,8% da pontuação |
| Folha de macieira com sarna | `Apple___Apple_scab`, 0,999985662 | Macieira |
| Logo do EcoPlant | Rejeição por incompatibilidade | Sem espécie atribuída |
| Imagem verde uniforme | Rejeição por incompatibilidade | Sem espécie atribuída |

O navegador também executou a análise real da folha saudável no aplicativo público: reconheceu Tomateiro e aparência saudável com aproximadamente 97,9% para a classe. A diferença numérica em relação ao teste local é compatível com a decodificação, redução JPEG e processamento de canvas utilizados por cada caminho.

As fotos de referência vêm do [repositório PlantVillage](https://github.com/spMohanty/PlantVillage-Dataset/tree/master/raw/color). Não são apresentadas como avaliação independente de desempenho do modelo, pois pertencem ao domínio de seu treinamento. São verificações funcionais de carregamento, inferência e apresentação. Fotografias reais fora desse domínio podem ficar inconclusivas ou receber classificações incorretas.

## Regressões

`npm run check` cobre os contratos de carregamento, erros de rede e cache, cancelamento, recuperação de WebGL para CPU, integridade dos resultados, limites de confiança, identificação independente, compatibilidade com os campos do Firebase, relatório, histórico, rascunhos e escolha explícita do modelo. Os testes de erros usam dependências controladas e não medem acurácia.

O aplicativo ainda reconhece apenas 14 culturas e não confirma todas as doenças nem a saúde de toda a planta. Algumas categorias não distinguem uma espécie botânica exata. A primeira análise precisa de internet para obter os arquivos públicos; o cache verificado reduz downloads posteriores.
