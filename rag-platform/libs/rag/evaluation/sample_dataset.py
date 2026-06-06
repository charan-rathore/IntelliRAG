"""Sample evaluation dataset for chunking benchmarks.

This module provides example evaluation data to demonstrate
the benchmark system and serve as a template for creating
custom evaluation datasets.

For real benchmarks, you should:
1. Create evaluation samples from your actual documents
2. Use domain-relevant questions
3. Have ground truth answers validated by experts
"""

from __future__ import annotations

from .models import EvaluationDataset, EvaluationSample


SAMPLE_TECHNICAL_DOCUMENT = """
# Kubernetes Pod Scheduling

Kubernetes uses a scheduler to place pods on nodes in the cluster.
The scheduler considers multiple factors when making placement decisions.

## Resource Requests and Limits

Pods can specify resource requests and limits for CPU and memory.

### CPU Resources

CPU is specified in cores. You can use decimal values like 0.5 for half a core,
or use millicore notation like 500m.

```yaml
resources:
  requests:
    cpu: "500m"
  limits:
    cpu: "1000m"
```

### Memory Resources

Memory is specified in bytes. You can use suffixes like Ki, Mi, Gi.
Memory limits are strictly enforced - pods exceeding limits are OOM killed.

```yaml
resources:
  requests:
    memory: "128Mi"
  limits:
    memory: "256Mi"
```

## Node Selectors

Node selectors let you constrain pods to specific nodes based on labels.
This is useful for placing workloads on specific hardware.

```yaml
nodeSelector:
  disktype: ssd
```

## Affinity and Anti-Affinity

For more complex scheduling requirements, use affinity rules.

### Node Affinity

Node affinity is like node selectors but more expressive.
You can specify required or preferred rules.

### Pod Affinity

Pod affinity lets you co-locate pods based on labels of other pods.
This is useful for performance-sensitive workloads.

### Pod Anti-Affinity

Pod anti-affinity spreads pods across nodes or zones.
This improves fault tolerance by avoiding single points of failure.

## Taints and Tolerations

Taints mark nodes as unsuitable for most pods.
Only pods with matching tolerations can be scheduled.

### NoSchedule Taint

Prevents new pods from being scheduled unless they tolerate the taint.

### NoExecute Taint

Evicts existing pods that don't tolerate the taint.

## Priority and Preemption

Pods can have priority classes. Higher priority pods can preempt
lower priority pods when resources are scarce.

This ensures critical workloads always have resources available.
"""

SAMPLE_RUNBOOK_DOCUMENT = """
# Database Connection Pool Exhaustion Runbook

## Overview

This runbook covers diagnosing and resolving database connection pool
exhaustion issues in our microservices architecture.

## Symptoms

1. Services returning HTTP 503 errors
2. Database connection timeout errors in logs
3. High latency on database-dependent endpoints
4. Connection pool metrics showing near-100% utilization

## Diagnostic Steps

### Step 1: Check Connection Pool Metrics

Query Prometheus for connection pool status:

```promql
db_connection_pool_active{service="api-gateway"}
db_connection_pool_available{service="api-gateway"}
```

### Step 2: Identify Slow Queries

Check for long-running queries that may be holding connections:

```sql
SELECT pid, now() - pg_stat_activity.query_start AS duration, query
FROM pg_stat_activity
WHERE state = 'active' AND now() - pg_stat_activity.query_start > interval '5 minutes';
```

### Step 3: Check for Connection Leaks

Look for services not properly closing connections:

```bash
kubectl logs deployment/api-gateway | grep "connection leak"
```

## Resolution Procedures

### Immediate Mitigation

1. Scale up affected services to increase total pool capacity
2. Restart pods with suspected connection leaks
3. Kill long-running queries if they are not critical

### Long-term Fixes

1. Add connection pool timeouts to prevent leaks
2. Implement query timeouts at the application level
3. Add circuit breakers for database calls
4. Review and optimize slow queries

## Escalation

If connection pool issues persist after following this runbook:

1. Page the database team (PagerDuty: db-oncall)
2. Consider read replica failover if primary is overloaded
3. Prepare for emergency database scaling
"""


def create_sample_kubernetes_dataset() -> EvaluationDataset:
    """Create sample evaluation dataset for Kubernetes documentation."""
    samples = [
        EvaluationSample(
            question="How do you specify CPU resources for a Kubernetes pod?",
            ground_truth="CPU is specified in cores using decimal values like 0.5 for half a core, or millicore notation like 500m. You set cpu under resources.requests and resources.limits in the pod spec.",
            reference_context=[
                "CPU is specified in cores. You can use decimal values like 0.5 for half a core, or use millicore notation like 500m.",
                "resources:\n  requests:\n    cpu: \"500m\"\n  limits:\n    cpu: \"1000m\""
            ],
            document_id="kubernetes_scheduling",
            metadata={"topic": "resources", "difficulty": "basic"},
        ),
        EvaluationSample(
            question="What happens when a pod exceeds its memory limit?",
            ground_truth="When a pod exceeds its memory limit, it gets OOM (Out of Memory) killed. Memory limits are strictly enforced by Kubernetes.",
            reference_context=[
                "Memory limits are strictly enforced - pods exceeding limits are OOM killed."
            ],
            document_id="kubernetes_scheduling",
            metadata={"topic": "resources", "difficulty": "basic"},
        ),
        EvaluationSample(
            question="How can you spread pods across different nodes for fault tolerance?",
            ground_truth="Use pod anti-affinity rules to spread pods across nodes or zones. This improves fault tolerance by avoiding single points of failure.",
            reference_context=[
                "Pod anti-affinity spreads pods across nodes or zones. This improves fault tolerance by avoiding single points of failure."
            ],
            document_id="kubernetes_scheduling",
            metadata={"topic": "scheduling", "difficulty": "intermediate"},
        ),
        EvaluationSample(
            question="What is the difference between NoSchedule and NoExecute taints?",
            ground_truth="NoSchedule prevents new pods from being scheduled on the node unless they tolerate the taint. NoExecute goes further and evicts existing pods that don't tolerate the taint.",
            reference_context=[
                "NoSchedule Taint: Prevents new pods from being scheduled unless they tolerate the taint.",
                "NoExecute Taint: Evicts existing pods that don't tolerate the taint."
            ],
            document_id="kubernetes_scheduling",
            metadata={"topic": "taints", "difficulty": "intermediate"},
        ),
        EvaluationSample(
            question="How do pod priorities work in Kubernetes?",
            ground_truth="Pods can have priority classes assigned to them. Higher priority pods can preempt (evict) lower priority pods when cluster resources are scarce. This ensures critical workloads always have resources available.",
            reference_context=[
                "Pods can have priority classes. Higher priority pods can preempt lower priority pods when resources are scarce.",
                "This ensures critical workloads always have resources available."
            ],
            document_id="kubernetes_scheduling",
            metadata={"topic": "scheduling", "difficulty": "advanced"},
        ),
    ]
    
    return EvaluationDataset(
        name="kubernetes_scheduling_eval",
        description="Evaluation dataset for Kubernetes scheduling documentation",
        samples=samples,
        source_documents=["kubernetes_scheduling"],
    )


def create_sample_runbook_dataset() -> EvaluationDataset:
    """Create sample evaluation dataset for runbook documentation."""
    samples = [
        EvaluationSample(
            question="What are the symptoms of database connection pool exhaustion?",
            ground_truth="Symptoms include: HTTP 503 errors from services, database connection timeout errors in logs, high latency on database-dependent endpoints, and connection pool metrics showing near-100% utilization.",
            reference_context=[
                "1. Services returning HTTP 503 errors",
                "2. Database connection timeout errors in logs",
                "3. High latency on database-dependent endpoints",
                "4. Connection pool metrics showing near-100% utilization"
            ],
            document_id="db_connection_runbook",
            metadata={"type": "runbook", "severity": "high"},
        ),
        EvaluationSample(
            question="How do you check for long-running database queries?",
            ground_truth="Query pg_stat_activity to find active queries running longer than a threshold. Use: SELECT pid, now() - pg_stat_activity.query_start AS duration, query FROM pg_stat_activity WHERE state = 'active' AND now() - pg_stat_activity.query_start > interval '5 minutes';",
            reference_context=[
                "Check for long-running queries that may be holding connections:",
                "SELECT pid, now() - pg_stat_activity.query_start AS duration, query\nFROM pg_stat_activity\nWHERE state = 'active' AND now() - pg_stat_activity.query_start > interval '5 minutes';"
            ],
            document_id="db_connection_runbook",
            metadata={"type": "runbook", "severity": "high"},
        ),
        EvaluationSample(
            question="What immediate actions should be taken for connection pool exhaustion?",
            ground_truth="Immediate mitigation steps: 1) Scale up affected services to increase total pool capacity, 2) Restart pods with suspected connection leaks, 3) Kill long-running queries if they are not critical.",
            reference_context=[
                "1. Scale up affected services to increase total pool capacity",
                "2. Restart pods with suspected connection leaks",
                "3. Kill long-running queries if they are not critical"
            ],
            document_id="db_connection_runbook",
            metadata={"type": "runbook", "severity": "high"},
        ),
        EvaluationSample(
            question="Who should be contacted for escalation of database issues?",
            ground_truth="Page the database team through PagerDuty using the db-oncall handle. Also consider read replica failover if the primary is overloaded and prepare for emergency database scaling.",
            reference_context=[
                "1. Page the database team (PagerDuty: db-oncall)",
                "2. Consider read replica failover if primary is overloaded",
                "3. Prepare for emergency database scaling"
            ],
            document_id="db_connection_runbook",
            metadata={"type": "runbook", "severity": "critical"},
        ),
    ]
    
    return EvaluationDataset(
        name="runbook_eval",
        description="Evaluation dataset for operational runbooks",
        samples=samples,
        source_documents=["db_connection_runbook"],
    )


def create_combined_sample_dataset() -> EvaluationDataset:
    """Create a combined dataset with multiple document types."""
    k8s_dataset = create_sample_kubernetes_dataset()
    runbook_dataset = create_sample_runbook_dataset()
    
    return EvaluationDataset(
        name="combined_eval",
        description="Combined evaluation dataset for multiple document types",
        samples=k8s_dataset.samples + runbook_dataset.samples,
        source_documents=["kubernetes_scheduling", "db_connection_runbook"],
    )


def get_sample_documents() -> dict[str, str]:
    """Get sample documents for benchmarking."""
    return {
        "kubernetes_scheduling": SAMPLE_TECHNICAL_DOCUMENT,
        "db_connection_runbook": SAMPLE_RUNBOOK_DOCUMENT,
    }


def run_sample_benchmark():
    """Run a sample benchmark to demonstrate the evaluation system.
    
    Returns:
        StrategyComparison with benchmark results.
    """
    from .benchmark import ChunkingBenchmark
    
    dataset = create_combined_sample_dataset()
    documents = get_sample_documents()
    
    benchmark = ChunkingBenchmark(
        dataset=dataset,
        source_documents=documents,
        use_embeddings=False,
    )
    
    results = benchmark.run_comparison(
        strategies=["recursive", "structure_aware"],
        chunk_sizes=[256, 512],
        overlaps=[25, 50],
    )
    
    return results
