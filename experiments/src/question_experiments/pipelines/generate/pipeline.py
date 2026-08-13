"""Generation pipeline: render one prompt, ask every model, store the rows.

Rating is deliberately absent. A node that blocks on human keypresses makes `kedro run`
un-runnable unattended, so `rate.py` and `metrics.py` sit outside the graph and read the
files this pipeline writes.
"""

from kedro.pipeline import Pipeline, node

from .nodes import build_run_config, generate_questions, persist_run


def create_pipeline(**kwargs) -> Pipeline:
    return Pipeline(
        [
            node(
                func=build_run_config,
                inputs="params:experiment",
                outputs="run_config",
                name="build_run_config",
            ),
            node(
                func=generate_questions,
                inputs="run_config",
                outputs="question_rows",
                name="generate_questions",
            ),
            node(
                func=persist_run,
                inputs=["question_rows", "run_config"],
                outputs="run_summary",
                name="persist_run",
            ),
        ]
    )
