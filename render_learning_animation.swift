#!/usr/bin/swift

import AppKit
import Foundation
import ImageIO
import UniformTypeIdentifiers

struct Snapshot: Decodable {
    let episode: Int
    let episodeReturn: Double
    let path: [[Int]]
    let valueFrames: [[Double]]

    enum CodingKeys: String, CodingKey {
        case episode
        case episodeReturn = "episode_return"
        case path
        case valueFrames = "value_frames"
    }
}

struct AnimationData: Decodable {
    let algorithm: String
    let displayName: String
    let updateNote: String
    let rows: Int
    let cols: Int
    let start: [Int]
    let goal: [Int]
    let walls: [[Int]]
    let gamma: Double
    let episodes: Int
    let seed: Int
    let episodeReturns: [Double]
    let snapshots: [Snapshot]

    enum CodingKeys: String, CodingKey {
        case algorithm
        case displayName = "display_name"
        case updateNote = "update_note"
        case rows, cols, start, goal, walls, gamma, episodes, seed
        case episodeReturns = "episode_returns"
        case snapshots
    }
}

let canvasWidth = 1600
let canvasHeight = 900
let white = NSColor(calibratedWhite: 0.99, alpha: 1)
let ink = NSColor(calibratedRed: 0.075, green: 0.10, blue: 0.15, alpha: 1)
let muted = NSColor(calibratedRed: 0.38, green: 0.43, blue: 0.50, alpha: 1)
let border = NSColor(calibratedRed: 0.80, green: 0.84, blue: 0.89, alpha: 1)
let panelFill = NSColor(calibratedRed: 0.965, green: 0.975, blue: 0.99, alpha: 1)
let ukBlue = NSColor(calibratedRed: 0.05, green: 0.25, blue: 0.56, alpha: 1)
let accentOrange = NSColor(calibratedRed: 0.92, green: 0.42, blue: 0.10, alpha: 1)
let accentGreen = NSColor(calibratedRed: 0.10, green: 0.53, blue: 0.34, alpha: 1)
let accentRed = NSColor(calibratedRed: 0.76, green: 0.17, blue: 0.20, alpha: 1)

func topRect(_ x: CGFloat, _ top: CGFloat, _ width: CGFloat, _ height: CGFloat) -> NSRect {
    NSRect(x: x, y: CGFloat(canvasHeight) - top - height, width: width, height: height)
}

func makeFont(_ size: CGFloat, bold: Bool = false, monospaced: Bool = false) -> NSFont {
    if monospaced {
        return NSFont.monospacedSystemFont(ofSize: size, weight: bold ? .semibold : .regular)
    }
    return NSFont.systemFont(ofSize: size, weight: bold ? .semibold : .regular)
}

func drawText(
    _ string: String,
    x: CGFloat,
    top: CGFloat,
    width: CGFloat,
    height: CGFloat,
    size: CGFloat,
    color: NSColor = ink,
    bold: Bool = false,
    alignment: NSTextAlignment = .left,
    monospaced: Bool = false
) {
    let paragraph = NSMutableParagraphStyle()
    paragraph.alignment = alignment
    paragraph.lineBreakMode = .byWordWrapping
    let attributes: [NSAttributedString.Key: Any] = [
        .font: makeFont(size, bold: bold, monospaced: monospaced),
        .foregroundColor: color,
        .paragraphStyle: paragraph,
    ]
    NSAttributedString(string: string, attributes: attributes).draw(
        in: topRect(x, top, width, height)
    )
}

func roundedPanel(_ rect: NSRect, fill: NSColor = panelFill) {
    let path = NSBezierPath(roundedRect: rect, xRadius: 18, yRadius: 18)
    fill.setFill()
    path.fill()
    border.setStroke()
    path.lineWidth = 2
    path.stroke()
}

func mix(_ low: NSColor, _ high: NSColor, amount: Double) -> NSColor {
    let t = CGFloat(max(0, min(1, amount)))
    let lowRGB = low.usingColorSpace(.deviceRGB)!
    let highRGB = high.usingColorSpace(.deviceRGB)!
    return NSColor(
        calibratedRed: lowRGB.redComponent * (1 - t) + highRGB.redComponent * t,
        green: lowRGB.greenComponent * (1 - t) + highRGB.greenComponent * t,
        blue: lowRGB.blueComponent * (1 - t) + highRGB.blueComponent * t,
        alpha: 1
    )
}

func pointForCell(
    _ cell: [Int], x: CGFloat, top: CGFloat, cellSize: CGFloat
) -> NSPoint {
    NSPoint(
        x: x + (CGFloat(cell[1]) + 0.5) * cellSize,
        y: CGFloat(canvasHeight) - top - (CGFloat(cell[0]) + 0.5) * cellSize
    )
}

func isSameCell(_ first: [Int], _ second: [Int]) -> Bool {
    first.count == 2 && second.count == 2 && first[0] == second[0] && first[1] == second[1]
}

func drawGridworld(_ data: AnimationData, path: [[Int]], currentIndex: Int) {
    let gridX: CGFloat = 70
    let gridTop: CGFloat = 202
    let gridSize: CGFloat = 550
    let cellSize = gridSize / CGFloat(data.cols)
    let wallSet = Set(data.walls.map { "\($0[0]),\($0[1])" })

    drawText("Current episode trajectory", x: 70, top: 157, width: 550,
             height: 36, size: 25, bold: true)

    for row in 0..<data.rows {
        for col in 0..<data.cols {
            let key = "\(row),\(col)"
            let rect = topRect(
                gridX + CGFloat(col) * cellSize,
                gridTop + CGFloat(row) * cellSize,
                cellSize,
                cellSize
            )
            let cellPath = NSBezierPath(rect: rect)
            if wallSet.contains(key) {
                NSColor(calibratedWhite: 0.73, alpha: 1).setFill()
            } else if isSameCell([row, col], data.goal) {
                NSColor(calibratedRed: 0.86, green: 0.96, blue: 0.89, alpha: 1).setFill()
            } else {
                white.setFill()
            }
            cellPath.fill()
            border.setStroke()
            cellPath.lineWidth = 1.5
            cellPath.stroke()

            if wallSet.contains(key) {
                drawText("wall", x: rect.minX, top: gridTop + CGFloat(row) * cellSize + 39,
                         width: cellSize, height: 32, size: 18, color: muted,
                         bold: true, alignment: .center)
            } else if isSameCell([row, col], data.goal) {
                drawText("GOAL\n+1", x: rect.minX,
                         top: gridTop + CGFloat(row) * cellSize + 28,
                         width: cellSize, height: 58, size: 18, color: accentGreen,
                         bold: true, alignment: .center)
            } else if isSameCell([row, col], data.start) {
                drawText("START", x: rect.minX,
                         top: gridTop + CGFloat(row) * cellSize + 43,
                         width: cellSize, height: 30, size: 16, color: muted,
                         bold: true, alignment: .center)
            }
        }
    }

    if currentIndex > 0 {
        let route = NSBezierPath()
        route.move(to: pointForCell(path[0], x: gridX, top: gridTop, cellSize: cellSize))
        for cell in path[1...currentIndex] {
            route.line(to: pointForCell(cell, x: gridX, top: gridTop, cellSize: cellSize))
        }
        accentOrange.withAlphaComponent(0.78).setStroke()
        route.lineWidth = 9
        route.lineCapStyle = .round
        route.lineJoinStyle = .round
        route.stroke()
    }

    let agentPoint = pointForCell(path[currentIndex], x: gridX, top: gridTop, cellSize: cellSize)
    let agentRect = NSRect(x: agentPoint.x - 19, y: agentPoint.y - 19, width: 38, height: 38)
    ukBlue.setFill()
    NSBezierPath(ovalIn: agentRect).fill()
    white.setStroke()
    let outline = NSBezierPath(ovalIn: agentRect.insetBy(dx: 3, dy: 3))
    outline.lineWidth = 3
    outline.stroke()
}

func drawValueMap(_ data: AnimationData, values: [Double], currentCell: [Int]) {
    let mapX: CGFloat = 716
    let mapTop: CGFloat = 202
    let mapSize: CGFloat = 360
    let cellSize = mapSize / CGFloat(data.cols)
    let wallSet = Set(data.walls.map { "\($0[0]),\($0[1])" })
    let lowColor = NSColor(calibratedRed: 0.82, green: 0.89, blue: 0.98, alpha: 1)
    let highColor = NSColor(calibratedRed: 1.00, green: 0.76, blue: 0.25, alpha: 1)

    drawText("Learned value  V(s)", x: mapX, top: 157, width: mapSize,
             height: 36, size: 25, bold: true)

    for row in 0..<data.rows {
        for col in 0..<data.cols {
            let key = "\(row),\(col)"
            let index = row * data.cols + col
            let rect = topRect(
                mapX + CGFloat(col) * cellSize,
                mapTop + CGFloat(row) * cellSize,
                cellSize,
                cellSize
            )
            let cellPath = NSBezierPath(rect: rect)
            if wallSet.contains(key) {
                NSColor(calibratedWhite: 0.78, alpha: 1).setFill()
            } else if isSameCell([row, col], data.goal) {
                NSColor(calibratedWhite: 0.94, alpha: 1).setFill()
            } else {
                let normalized = (values[index] + 0.30) / 1.20
                mix(lowColor, highColor, amount: normalized).setFill()
            }
            cellPath.fill()
            border.setStroke()
            cellPath.lineWidth = 1.2
            cellPath.stroke()

            if wallSet.contains(key) {
                drawText("—", x: rect.minX, top: mapTop + CGFloat(row) * cellSize + 22,
                         width: cellSize, height: 28, size: 18, color: muted,
                         alignment: .center)
            } else if isSameCell([row, col], data.goal) {
                drawText("T", x: rect.minX, top: mapTop + CGFloat(row) * cellSize + 22,
                         width: cellSize, height: 28, size: 18, color: accentGreen,
                         bold: true, alignment: .center)
            } else {
                drawText(String(format: "%.2f", values[index]), x: rect.minX,
                         top: mapTop + CGFloat(row) * cellSize + 22,
                         width: cellSize, height: 28, size: 16, color: ink,
                         alignment: .center, monospaced: true)
            }

            if isSameCell([row, col], currentCell) {
                accentRed.setStroke()
                let currentOutline = NSBezierPath(rect: rect.insetBy(dx: 3, dy: 3))
                currentOutline.lineWidth = 5
                currentOutline.stroke()
            }
        }
    }

    let legendTop: CGFloat = 578
    let segmentWidth = mapSize / 50
    for segment in 0..<50 {
        let color = mix(lowColor, highColor, amount: Double(segment) / 49.0)
        color.setFill()
        topRect(mapX + CGFloat(segment) * segmentWidth, legendTop,
                segmentWidth + 1, 13).fill()
    }
    drawText("lower value", x: mapX, top: 596, width: 150, height: 26,
             size: 15, color: muted)
    drawText("higher value", x: mapX + mapSize - 150, top: 596,
             width: 150, height: 26, size: 15, color: muted, alignment: .right)
}

func movingAverage(_ values: ArraySlice<Double>, window: Int) -> [Double] {
    let values = Array(values)
    guard !values.isEmpty else { return [] }
    return values.indices.map { index in
        let start = max(0, index - window + 1)
        let slice = values[start...index]
        return slice.reduce(0, +) / Double(slice.count)
    }
}

func drawPerformance(_ data: AnimationData, completedEpisodes: Int) {
    let chartX: CGFloat = 1150
    let chartTop: CGFloat = 202
    let chartWidth: CGFloat = 390
    let chartHeight: CGFloat = 360
    let yMin = -1.10
    let yMax = 1.05

    drawText("Performance", x: chartX, top: 157, width: chartWidth,
             height: 36, size: 25, bold: true)

    white.setFill()
    topRect(chartX, chartTop, chartWidth, chartHeight).fill()

    func plotPoint(episode: Int, value: Double) -> NSPoint {
        let x = chartX + CGFloat(episode) / CGFloat(data.episodes) * chartWidth
        let normalized = (value - yMin) / (yMax - yMin)
        let yFromTop = chartTop + (1 - CGFloat(normalized)) * chartHeight
        return NSPoint(x: x, y: CGFloat(canvasHeight) - yFromTop)
    }

    for tick in [-1.0, 0.0, 1.0] {
        let point = plotPoint(episode: 0, value: tick)
        NSColor(calibratedWhite: 0.88, alpha: 1).setStroke()
        let grid = NSBezierPath()
        grid.move(to: NSPoint(x: chartX, y: point.y))
        grid.line(to: NSPoint(x: chartX + chartWidth, y: point.y))
        grid.lineWidth = 1
        grid.stroke()
        drawText(String(format: "%+.0f", tick), x: chartX - 42,
                 top: CGFloat(canvasHeight) - point.y - 11,
                 width: 36, height: 24, size: 14, color: muted,
                 alignment: .right, monospaced: true)
    }

    border.setStroke()
    let axes = NSBezierPath(rect: topRect(chartX, chartTop, chartWidth, chartHeight))
    axes.lineWidth = 1.5
    axes.stroke()

    let count = max(0, min(completedEpisodes, data.episodeReturns.count))
    if count > 0 {
        let returns = data.episodeReturns.prefix(count)
        let rawPath = NSBezierPath()
        for (index, value) in returns.enumerated() {
            let point = plotPoint(episode: index + 1, value: value)
            index == 0 ? rawPath.move(to: point) : rawPath.line(to: point)
        }
        NSColor(calibratedWhite: 0.68, alpha: 0.65).setStroke()
        rawPath.lineWidth = 2
        rawPath.stroke()

        let averages = movingAverage(returns, window: 20)
        let meanPath = NSBezierPath()
        for (index, value) in averages.enumerated() {
            let point = plotPoint(episode: index + 1, value: value)
            index == 0 ? meanPath.move(to: point) : meanPath.line(to: point)
        }
        ukBlue.setStroke()
        meanPath.lineWidth = 6
        meanPath.lineCapStyle = .round
        meanPath.lineJoinStyle = .round
        meanPath.stroke()

        let finalPoint = plotPoint(episode: count, value: averages.last!)
        accentOrange.setFill()
        NSBezierPath(ovalIn: NSRect(x: finalPoint.x - 7, y: finalPoint.y - 7,
                                    width: 14, height: 14)).fill()
    }

    drawText("episode", x: chartX + chartWidth - 90, top: 570,
             width: 90, height: 24, size: 15, color: muted, alignment: .right)
    drawText("raw return", x: chartX, top: 598, width: 120,
             height: 24, size: 15, color: muted)
    NSColor(calibratedWhite: 0.68, alpha: 0.9).setStroke()
    let rawLegend = NSBezierPath()
    rawLegend.move(to: NSPoint(x: chartX + 2, y: CGFloat(canvasHeight) - 633))
    rawLegend.line(to: NSPoint(x: chartX + 54, y: CGFloat(canvasHeight) - 633))
    rawLegend.lineWidth = 3
    rawLegend.stroke()
    drawText("20-episode mean", x: chartX + 135, top: 598,
             width: 190, height: 24, size: 15, color: muted)
    ukBlue.setStroke()
    let meanLegend = NSBezierPath()
    meanLegend.move(to: NSPoint(x: chartX + 137, y: CGFloat(canvasHeight) - 633))
    meanLegend.line(to: NSPoint(x: chartX + 189, y: CGFloat(canvasHeight) - 633))
    meanLegend.lineWidth = 5
    meanLegend.stroke()
}

func renderFrame(
    data: AnimationData,
    snapshot: Snapshot,
    currentIndex: Int,
    isEpisodeComplete: Bool
) -> NSBitmapImageRep {
    let bitmap = NSBitmapImageRep(
        bitmapDataPlanes: nil,
        pixelsWide: canvasWidth,
        pixelsHigh: canvasHeight,
        bitsPerSample: 8,
        samplesPerPixel: 4,
        hasAlpha: true,
        isPlanar: false,
        colorSpaceName: .deviceRGB,
        bytesPerRow: 0,
        bitsPerPixel: 0
    )!
    let graphics = NSGraphicsContext(bitmapImageRep: bitmap)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = graphics

    white.setFill()
    NSRect(x: 0, y: 0, width: canvasWidth, height: canvasHeight).fill()
    ukBlue.setFill()
    topRect(0, 0, CGFloat(canvasWidth), 13).fill()

    let steps = currentIndex
    let currentCell = snapshot.path[currentIndex]
    let reachedGoal = isSameCell(currentCell, data.goal)
    let rawReturnSoFar = reachedGoal
        ? 1.0 - 0.03 * Double(max(0, steps - 1))
        : -0.03 * Double(steps)
    let returnSoFar = abs(rawReturnSoFar) < 0.005 ? 0.0 : rawReturnSoFar
    drawText("Learning from interaction: \(data.displayName)", x: 48, top: 30,
             width: 1050, height: 48, size: 35, bold: true)
    drawText(
        String(format: "episode %d / %d    step %d / %d    return so far %+.2f",
               snapshot.episode, data.episodes, steps, snapshot.path.count - 1,
               returnSoFar),
        x: 50, top: 86, width: 950, height: 34, size: 22, color: muted,
        monospaced: true
    )
    drawText("seed \(data.seed)    γ = \(String(format: "%.2f", data.gamma))",
             x: 1170, top: 45, width: 370, height: 32, size: 19,
             color: muted, alignment: .right, monospaced: true)

    roundedPanel(topRect(38, 137, 606, 657), fill: panelFill)
    roundedPanel(topRect(684, 137, 420, 500), fill: panelFill)
    roundedPanel(topRect(1124, 137, 436, 500), fill: panelFill)
    roundedPanel(topRect(684, 657, 876, 137), fill: white)

    drawGridworld(data, path: snapshot.path, currentIndex: currentIndex)
    drawValueMap(data, values: snapshot.valueFrames[currentIndex], currentCell: currentCell)
    let completed = isEpisodeComplete ? snapshot.episode : snapshot.episode - 1
    drawPerformance(data, completedEpisodes: completed)

    let updateLabel = data.algorithm == "reinforce"
        ? "EPISODE-END UPDATE" : "ONE-STEP TD UPDATE"
    let updateColor = data.algorithm == "reinforce" ? accentOrange : accentGreen
    drawText(updateLabel, x: 716, top: 681, width: 300, height: 30,
             size: 18, color: updateColor, bold: true)
    drawText(data.updateNote, x: 716, top: 716, width: 790, height: 33,
             size: 23, color: ink, bold: true)
    let detail = data.algorithm == "reinforce"
        ? "Full returns Gₜ are available only after the complete trajectory."
        : "δₜ = Rₜ₊₁ + γV(Sₜ₊₁) − V(Sₜ) updates both critic and actor."
    drawText(detail, x: 716, top: 756, width: 800, height: 32,
             size: 19, color: muted)

    drawText("The orange path is the sampled interaction; the red outline marks the current state in the value map.",
             x: 52, top: 825, width: 1496, height: 34, size: 18,
             color: muted, alignment: .center)

    NSGraphicsContext.restoreGraphicsState()
    return bitmap
}

func displayedIndices(count: Int, maximum: Int = 15) -> [Int] {
    guard count > maximum else { return Array(0..<count) }
    let stride = Double(count - 1) / Double(maximum - 1)
    var result = (0..<maximum).map { Int(round(Double($0) * stride)) }
    result[0] = 0
    result[result.count - 1] = count - 1
    return Array(Set(result)).sorted()
}

guard CommandLine.arguments.count >= 2 else {
    fatalError("usage: swift render_learning_animation.swift DATA.json [OUTPUT.gif]")
}

let inputURL = URL(fileURLWithPath: CommandLine.arguments[1])
let baseName = inputURL.deletingPathExtension().lastPathComponent
    .replacingOccurrences(of: "-animation-data", with: "")
let outputURL = CommandLine.arguments.count >= 3
    ? URL(fileURLWithPath: CommandLine.arguments[2])
    : inputURL.deletingLastPathComponent().appendingPathComponent("\(baseName)-learning.gif")
let posterURL = inputURL.deletingLastPathComponent()
    .appendingPathComponent("\(baseName)-learning-poster.png")

let data = try JSONDecoder().decode(
    AnimationData.self,
    from: Data(contentsOf: inputURL)
)

guard let destination = CGImageDestinationCreateWithURL(
    outputURL as CFURL,
    UTType.gif.identifier as CFString,
    0,
    nil
) else {
    fatalError("Could not create GIF destination")
}

let gifProperties: CFDictionary = [
    kCGImagePropertyGIFDictionary: [
        kCGImagePropertyGIFLoopCount: 0
    ]
] as CFDictionary
CGImageDestinationSetProperties(destination, gifProperties)

var finalBitmap: NSBitmapImageRep?
var frameCount = 0
for snapshot in data.snapshots {
    let indices = displayedIndices(count: snapshot.path.count)
    for index in indices {
        let complete = index == snapshot.path.count - 1
        let bitmap = renderFrame(
            data: data,
            snapshot: snapshot,
            currentIndex: index,
            isEpisodeComplete: complete
        )
        let delay = complete ? 0.90 : 0.13
        let frameProperties: CFDictionary = [
            kCGImagePropertyGIFDictionary: [
                kCGImagePropertyGIFDelayTime: delay,
                kCGImagePropertyGIFUnclampedDelayTime: delay,
            ]
        ] as CFDictionary
        CGImageDestinationAddImage(destination, bitmap.cgImage!, frameProperties)
        finalBitmap = bitmap
        frameCount += 1
    }
}

guard CGImageDestinationFinalize(destination) else {
    fatalError("Could not finalize GIF")
}
if let poster = finalBitmap?.representation(using: .png, properties: [:]) {
    try poster.write(to: posterURL)
}
print("wrote \(outputURL.lastPathComponent) with \(frameCount) frames")
print("wrote \(posterURL.lastPathComponent)")
