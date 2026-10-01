// Offline piano performance using macOS's installed General MIDI instrument bank.
// Only the rendered composition is shipped; the system sound bank is not copied.
import Foundation
import AVFoundation
import AudioToolbox

struct Note: Decodable {
    let time: Double
    let duration: Double
    let pitch: UInt8
    let velocity: UInt8
    let channel: UInt8
}
struct Score: Decodable {
    let duration: Double
    let sampleRate: Double
    let notes: [Note]
}
struct Event {
    let frame: Int64
    let note: Note
    let on: Bool
}
let score = try JSONDecoder().decode(Score.self, from: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1])))
let engine = AVAudioEngine()
let piano = AVAudioUnitSampler()
engine.attach(piano)
let format = AVAudioFormat(standardFormatWithSampleRate: score.sampleRate, channels: 2)!
engine.connect(piano, to: engine.mainMixerNode, format: format)
let bank = URL(fileURLWithPath: "/System/Library/Components/CoreAudio.component/Contents/Resources/gs_instruments.dls")
try piano.loadSoundBankInstrument(at: bank, program: 0, bankMSB: UInt8(kAUSampler_DefaultMelodicBankMSB), bankLSB: 0)
for channel in UInt8(0)...4 {
    piano.sendProgramChange(0, onChannel: channel)
    piano.sendController(91, withValue: 0, onChannel: channel)
}
try engine.enableManualRenderingMode(.offline, format: format, maximumFrameCount: 512)
try engine.start()
var file: AVAudioFile? = try AVAudioFile(forWriting: URL(fileURLWithPath: CommandLine.arguments[2]), settings: [
    AVFormatIDKey: kAudioFormatLinearPCM, AVSampleRateKey: score.sampleRate,
    AVNumberOfChannelsKey: 2, AVLinearPCMBitDepthKey: 16,
    AVLinearPCMIsFloatKey: false, AVLinearPCMIsBigEndianKey: false
])
let buffer = AVAudioPCMBuffer(pcmFormat: engine.manualRenderingFormat, frameCapacity: 512)!
var events = score.notes.flatMap { note in
    [Event(frame: Int64((note.time * score.sampleRate).rounded()), note: note, on: true),
     Event(frame: Int64(((note.time + note.duration) * score.sampleRate).rounded()), note: note, on: false)]
}.sorted { $0.frame == $1.frame ? (!$0.on && $1.on) : $0.frame < $1.frame }
var index = 0
var retries = 0
let end = Int64(((score.duration + 4) * score.sampleRate).rounded())
while engine.manualRenderingSampleTime < end {
    let frame = engine.manualRenderingSampleTime
    while index < events.count && events[index].frame <= frame {
        let event = events[index]
        if event.on { piano.startNote(event.note.pitch, withVelocity: event.note.velocity, onChannel: event.note.channel) }
        else { piano.stopNote(event.note.pitch, onChannel: event.note.channel) }
        index += 1
    }
    let next = index < events.count ? events[index].frame : end
    let count = AVAudioFrameCount(min(512, min(end - frame, max(1, next - frame))))
    switch try engine.renderOffline(count, to: buffer) {
    case .success:
        try file!.write(from: buffer)
        retries = 0
    case .cannotDoInCurrentContext:
        retries += 1
        if retries > 100 { fatalError("Offline piano renderer stalled") }
    default: fatalError("Unable to render the piano performance")
    }
}
engine.stop()
file = nil // Finalize WAV length before the parent process reads it.
print("Rendered \(score.notes.count) piano notes, \(score.duration) seconds + release tail")
