package id.byga.bridge
import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.atomic.AtomicInteger
class OneShotGateTest {
 @Test fun defaultDenySingleUseExpiryAndStop() { var now=1L; val gate=OneShotGate { now }; assertFalse(gate.consume()); gate.grantOne(); assertTrue(gate.consume()); assertFalse(gate.consume()); gate.grantOne(); now+=60_001; assertFalse(gate.consume()); gate.grantOne(); gate.stop(); assertFalse(gate.consume()) }
 @Test fun onlyOneConcurrentConsumer() { val gate=OneShotGate { 1L }; gate.grantOne(); val count=AtomicInteger(); val threads=(1..20).map { Thread { if(gate.consume())count.incrementAndGet() } }; threads.forEach { it.start() }; threads.forEach { it.join() }; assertEquals(1,count.get()) }
}
