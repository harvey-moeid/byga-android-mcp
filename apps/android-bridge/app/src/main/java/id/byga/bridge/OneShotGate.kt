package id.byga.bridge
import java.util.concurrent.atomic.AtomicInteger
class OneShotGate(private val now: () -> Long) {
    private val remaining = AtomicInteger(0)
    @Volatile private var until: Long = 0
    fun grantOne() { until = now() + 60_000; remaining.set(1) }
    fun stop() { remaining.set(0); until = 0 }
    fun consume(): Boolean = now() < until && remaining.compareAndSet(1, 0)
}
