// SharedBoard.app — Andrew Barresi (https://github.com/AndBarresi). MIT.
#import <Cocoa/Cocoa.h>
#import <dispatch/dispatch.h>

@interface SharedBoardDelegate : NSObject <NSApplicationDelegate>
@property(nonatomic) BOOL started;
@property(nonatomic, strong) NSTask *task;
@end

@implementation SharedBoardDelegate
- (void)finishWithMessage:(NSString *)message {
    if (message.length) {
        NSAlert *alert = [[NSAlert alloc] init];
        alert.messageText = @"SharedBoard Bridge could not start";
        alert.informativeText = message;
        [alert addButtonWithTitle:@"OK"];
        [NSApp activateIgnoringOtherApps:YES];
        NSTimer *timer = [NSTimer timerWithTimeInterval:15 repeats:NO block:^(NSTimer *unused) {
            (void)unused;
            [NSApp abortModal];
        }];
        [[NSRunLoop currentRunLoop] addTimer:timer forMode:NSModalPanelRunLoopMode];
        [alert runModal];
        [timer invalidate];
    }
    [NSApp terminate:nil];
}

- (void)launchForURL:(BOOL)fromURL {
    if (self.started) return;
    self.started = YES;
    NSString *script = [[[NSBundle mainBundle] resourcePath] stringByAppendingPathComponent:@"bridge.command"];
    NSTask *task = [[NSTask alloc] init];
    self.task = task;
    task.executableURL = [NSURL fileURLWithPath:@"/bin/bash"];
    // URLs never become shell source or arguments. Only these fixed actions run.
    task.arguments = fromURL ? @[script, @"--start", @"--no-browser"] : @[script, @"--install"];
    NSPipe *output = [NSPipe pipe];
    task.standardOutput = output;
    task.standardError = output;
    task.terminationHandler = ^(NSTask *finished) {
        NSData *data = [[output fileHandleForReading] readDataToEndOfFile];
        NSString *text = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
        if (text.length > 4000) text = [text substringToIndex:4000];
        dispatch_async(dispatch_get_main_queue(), ^{
            [self finishWithMessage:finished.terminationStatus == 0 ? nil : (text ?: @"Return to the webpage and try Check bridge again.")];
        });
    };
    NSError *error = nil;
    if (![task launchAndReturnError:&error]) [self finishWithMessage:error.localizedDescription];
}

- (void)applicationDidFinishLaunching:(NSNotification *)notification {
    // A URL AppleEvent may arrive after this notification. The explicit launch
    // reason keeps a protocol launch from accidentally opening a browser tab.
    NSNumber *normalLaunch = notification.userInfo[NSApplicationLaunchIsDefaultLaunchKey];
    if (normalLaunch.boolValue) [self launchForURL:NO];
    else dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 30 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
        if (!self.started) [NSApp terminate:nil];
    });
}

- (void)application:(NSApplication *)application openURLs:(NSArray<NSURL *> *)urls {
    (void)application;
    (void)urls;
    [self launchForURL:YES];
}
@end

int main(int argc, const char *argv[]) {
    (void)argc;
    (void)argv;
    @autoreleasepool {
        NSApplication *application = [NSApplication sharedApplication];
        static SharedBoardDelegate *delegate;
        delegate = [[SharedBoardDelegate alloc] init];
        application.delegate = delegate;
        [application setActivationPolicy:NSApplicationActivationPolicyAccessory];
        [application run];
    }
    return 0;
}
