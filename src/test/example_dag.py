# example_dag.py

from airflow import DAG
from airflow.operators.bash import BashOperator
from datetime import datetime

# Define DAG
with DAG(
    dag_id='example_dag',
    start_date=datetime(2025, 1, 1),
    schedule_interval='@daily',
    catchup=False
) as dag:

    # Task 1
    t1 = BashOperator(
        task_id='print_date',
        bash_command='date'
    )

    # Task 2
    t2 = BashOperator(
        task_id='sleep',
        bash_command='sleep 5'
    )

    # Task 3P
    t3 = BashOperator(
        task_id='echo_hello',
        bash_command='echo "Hello World"'
    )

    # Define dependencies
    t1 >> t2 >> t3
