package id.byga.bridge
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
@RunWith(AndroidJUnit4::class)
class LocalGateTest {
 @Test fun grantIsSingleUseAndStopRevokes() { LocalGate.stop(); assertFalse(LocalGate.consume()); LocalGate.grantOne(); assertTrue(LocalGate.consume()); assertFalse(LocalGate.consume()); LocalGate.grantOne(); LocalGate.stop(); assertFalse(LocalGate.consume()) }
}
