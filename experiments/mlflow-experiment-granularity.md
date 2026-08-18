# Granularidade da experiment do MLflow

Onde cortar o bucket do MLflow: uma experiment por request, uma por config nomeada
(`conf/experiments/*.yml`), ou a fixa que já está em `conf/base/mlflow.yml`.
Fixo daqui pra frente: `config` e `config_hash` já são logados como params em
`build_run_config` (`nodes.py:99`), e o MLflow não tem API pra mover run entre experiments.

## A árvore

```
                    ┌──────────────────────┐
                    │ Bucket teria >1 run? │
                    └───────────┬──────────┘
        nao                     │                      sim
         ┌──────────────────────┴───────────────────────┐
         ▼                                              ▼
┌────────────────┐                            ┌───────────────────┐
│ run aninhada,  │                            │ Compara 2 buckets │
│ nao experiment │                            │      juntos?      │
└────────────────┘                            └─────────┬─────────┘
                                     sim                │                 nao
                                      ┌─────────────────┴──────────────────┐
                                      ▼                                    ▼
                            ┌───────────────────┐               ┌─────────────────────┐
                            │ Chave ja e param? │               │ Apaga o lote junto? │
                            └─────────┬─────────┘               └──────────┬──────────┘
                            sim       │        nao               sim       │       nao
                             ┌────────┴─────────┐                 ┌────────┴────────┐
                             ▼                  ▼                 ▼                 ▼
                     ┌──────────────┐   ┌──────────────┐   ┌────────────┐   ┌──────────────┐
                     │ 1 experiment │   │ loga a chave │   │ experiment │   │ 1 experiment │
                     │   + filtro   │   │  como param  │   │  por .yml  │   └──────────────┘
                     └──────────────┘   └──────────────┘   └────────────┘
```

## As perguntas

**Bucket teria >1 run?** Conte. Uma experiment com uma run é uma pasta com um arquivo:
não tem o que ordenar, filtrar ou plotar dentro dela. Se a coisa que você quer isolar
acontece uma vez por execução, ela é uma run, não uma experiment.

**Compara 2 buckets juntos?** A UI do MLflow plota dentro de uma experiment. Dá pra
selecionar várias na busca, mas gráfico e tabela de comparação são por experiment.
Se você precisa ver duas coisas no mesmo gráfico, elas moram na mesma experiment.

**Chave já é param?** Se sim, separar em experiments te dá o mesmo recorte que
`filter_string="params.x = '...'"` já dá, e cobra a comparação cruzada por isso.

**Apaga o lote junto?** Experiment é a unidade de deleção. Se um lote inteiro é lixo
previsível (um spike de teste), a experiment é a lixeira certa.

## Endpoints

**run aninhada, nao experiment** É onde "experiment por request" cai. Um request não
enche um bucket: você perde o rollup do lote, os traces deixam de agrupar, e a lista
de experiments vira um log. O MLflow já tem o nível certo pra isso, que é
`start_run(nested=True)` com `model` como param. Custa umas 10 linhas em
`generate_questions` e apaga o `_per_model_metrics` inteiro.

**1 experiment + filtro** O que você já tem, e o que a sua árvore devolve hoje:
`config_hash` é param, e você quer comparar `e6d1d84b322d` com `f06a27fd7f58` pra
decidir qual config fica. Mantém `question_experiments` em `conf/base/mlflow.yml`,
filtra por param. Custo: a tabela default mistura configs incomparáveis se você
esquecer o filtro, que foi exatamente o que aconteceu com a média do liquid.

**loga a chave como param** Só aparece se você quiser cortar por algo que não está
logado. Logar é mais barato que separar, porque param você adiciona depois e
experiment não: sem API de mover run, dividir errado vira trabalho de cópia.

**experiment por .yml** Faz sentido quando um lote é descartável por natureza.
`experiment-test.yml` é candidato: manda ele pra uma experiment `scratch` e apaga a
experiment quando cansar, sem catar run por run. Não faça isso com `cost-check-4.yml`,
que é resultado que você quer comparar com os outros.

**1 experiment** Mesmo destino, chegando por outro caminho: sem comparação cruzada e
sem lote descartável, dividir não paga nada.
